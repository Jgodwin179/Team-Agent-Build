"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useMutation, useQuery } from "convex/react";
import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import { api } from "../../convex/_generated/api";
import type { Doc, Id } from "../../convex/_generated/dataModel";
import { authClient } from "@/lib/auth-client";
import { ModeBanner } from "@/components/ModeBanner";
import { cn } from "@/lib/utils";

const NAV = [
  { href: "/dashboard", label: "Dashboard" },
  { href: "/deals", label: "Deals" },
  { href: "/runs", label: "Runs" },
];

type OrgWithRole = Doc<"organizations"> & {
  role: "owner" | "admin" | "member" | "viewer";
};

type OrgContextValue = {
  organizationId: Id<"organizations">;
  org: OrgWithRole;
};

const OrgContext = createContext<OrgContextValue | null>(null);

export function useActiveOrg() {
  const value = useContext(OrgContext);
  if (!value) {
    throw new Error("useActiveOrg must be used within AppShell");
  }
  return value;
}

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const user = useQuery(api.auth.getCurrentUser);
  const orgs = useQuery(api.organizations.listMine);
  const ensureDevWorkspace = useMutation(api.seed.ensureDevWorkspace);
  const [orgId, setOrgId] = useState<Id<"organizations"> | null>(null);
  const [seeded, setSeeded] = useState(false);

  useEffect(() => {
    if (!user || seeded) return;
    void ensureDevWorkspace()
      .then((result) => {
        setOrgId(result.primaryOrganizationId);
        setSeeded(true);
      })
      .catch((error: unknown) => {
        console.error("Failed to ensure dev workspace", error);
      });
  }, [user, seeded, ensureDevWorkspace]);

  useEffect(() => {
    if (!orgId && orgs && orgs.length > 0) {
      setOrgId(orgs[0]!._id);
    }
  }, [orgs, orgId]);

  const activeOrg = orgs?.find((o) => o._id === orgId) ?? orgs?.[0];

  if (user === undefined) {
    return (
      <div className="flex min-h-screen items-center justify-center text-slate-600">
        Loading session…
      </div>
    );
  }

  if (user === null) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4">
        <p className="text-slate-700">You must sign in to continue.</p>
        <Link
          href="/sign-in"
          className="rounded bg-slate-900 px-4 py-2 text-sm text-white"
        >
          Sign in
        </Link>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      <ModeBanner
        outboundDryRun={activeOrg?.outboundDryRun}
        isTestOrganization={activeOrg?.isTestOrganization}
      />
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-4 py-3">
          <div className="flex items-center gap-6">
            <Link
              href="/dashboard"
              className="text-lg font-semibold tracking-tight"
            >
              Team Agent Platform
            </Link>
            <nav className="flex gap-1">
              {NAV.map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  className={cn(
                    "rounded px-3 py-1.5 text-sm",
                    pathname.startsWith(item.href)
                      ? "bg-slate-900 text-white"
                      : "text-slate-600 hover:bg-slate-100",
                  )}
                >
                  {item.label}
                </Link>
              ))}
            </nav>
          </div>
          <div className="flex items-center gap-3 text-sm">
            {orgs && orgs.length > 0 ? (
              <label className="flex items-center gap-2">
                <span className="text-slate-500">Org</span>
                <select
                  className="rounded border border-slate-300 bg-white px-2 py-1"
                  value={activeOrg?._id ?? ""}
                  onChange={(e) =>
                    setOrgId(e.target.value as Id<"organizations">)
                  }
                >
                  {orgs.map((org) => (
                    <option key={org._id} value={org._id}>
                      {org.name} ({org.role})
                    </option>
                  ))}
                </select>
              </label>
            ) : null}
            <span className="text-slate-600">{user.email}</span>
            <button
              type="button"
              className="rounded border border-slate-300 px-2 py-1 hover:bg-slate-100"
              onClick={() => void authClient.signOut()}
            >
              Sign out
            </button>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-4 py-6">
        {activeOrg ? (
          <OrgContext.Provider
            value={{ organizationId: activeOrg._id, org: activeOrg }}
          >
            {children}
          </OrgContext.Provider>
        ) : (
          <p className="text-slate-600">Preparing test workspace…</p>
        )}
      </main>
    </div>
  );
}
