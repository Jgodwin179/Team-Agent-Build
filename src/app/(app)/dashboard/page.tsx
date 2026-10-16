"use client";

import { useQuery } from "convex/react";
import { api } from "../../../../convex/_generated/api";
import { useActiveOrg } from "@/components/AppShell";

export default function DashboardPage() {
  const { organizationId, org } = useActiveOrg();
  const deals = useQuery(api.deals.list, { organizationId });
  const runs = useQuery(api.runs.list, { organizationId });
  const members = useQuery(api.organizations.listMembers, { organizationId });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{org.name}</h1>
        <p className="mt-1 text-sm text-slate-600">
          Role: {org.role} · Timezone: {org.timezone} · Dry-run:{" "}
          {org.outboundDryRun ? "on" : "off"}
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <Stat label="Deals" value={deals?.length} />
        <Stat label="Runs" value={runs?.length} />
        <Stat
          label="Active members"
          value={members?.filter((m) => m.status === "active").length}
        />
      </div>

      <section className="space-y-2">
        <h2 className="text-lg font-medium">Recent runs</h2>
        {!runs ? (
          <p className="text-sm text-slate-500">Loading…</p>
        ) : runs.length === 0 ? (
          <p className="text-sm text-slate-500">No runs yet.</p>
        ) : (
          <ul className="divide-y divide-slate-200 rounded border border-slate-200 bg-white">
            {runs.slice(0, 8).map((run) => (
              <li
                key={run._id}
                className="flex items-center justify-between px-3 py-2 text-sm"
              >
                <span>{run.title}</span>
                <span className="rounded bg-slate-100 px-2 py-0.5 text-xs uppercase tracking-wide text-slate-700">
                  {run.status}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function Stat({ label, value }: { label: string; value?: number }) {
  return (
    <div className="rounded border border-slate-200 bg-white px-4 py-3">
      <p className="text-xs uppercase tracking-wide text-slate-500">{label}</p>
      <p className="mt-1 text-2xl font-semibold">
        {value === undefined ? "—" : value}
      </p>
    </div>
  );
}
