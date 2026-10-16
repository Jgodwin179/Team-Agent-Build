"use client";

import { FormEvent, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "../../../../convex/_generated/api";
import { useActiveOrg } from "@/components/AppShell";

const PROVIDERS = [
  "box",
  "ghl",
  "google_drive",
  "gmail",
  "google_calendar",
] as const;

export default function ConnectionsPage() {
  const { organizationId, org } = useActiveOrg();
  const connections = useQuery(api.connections.list, { organizationId });
  const caps = useQuery(api.connections.providerCapabilitySummary, {
    organizationId,
  });
  const connectMock = useMutation(api.connections.connectMock);
  const attachLive = useMutation(api.connections.attachLiveCredential);
  const disconnect = useMutation(api.connections.disconnect);
  const markNeedsReconnect = useMutation(api.connections.markNeedsReconnect);
  const scheduleRenewal = useMutation(api.connections.scheduleRenewal);
  const acknowledgeReconnected = useMutation(
    api.connections.acknowledgeReconnected,
  );
  const needingAttention = useQuery(api.connections.listNeedingAttention, {
    organizationId,
  });
  const [provider, setProvider] =
    useState<(typeof PROVIDERS)[number]>("box");
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [liveConnectionId, setLiveConnectionId] = useState("");
  const [managedRef, setManagedRef] = useState("");
  const [composioUserId, setComposioUserId] = useState("");
  const canAdmin = org.role === "owner" || org.role === "admin";

  async function onConnectMock(event: FormEvent) {
    event.preventDefault();
    setError(null);
    try {
      await connectMock({ organizationId, provider });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Connect failed");
    }
  }

  async function onAttachLive(event: FormEvent) {
    event.preventDefault();
    setError(null);
    try {
      await attachLive({
        organizationId,
        connectionId: liveConnectionId as never,
        managedCredentialRef: managedRef,
        composioUserId,
      });
      setManagedRef("");
      setComposioUserId("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Attach failed");
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Connections</h1>
        <p className="mt-1 text-sm text-slate-600">
          Onboard provider accounts. MOCK connections are labeled and never
          presented as live OAuth.
        </p>
      </div>

      <div className="rounded border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950">
        <p className="font-medium">Provider setup</p>
        <ul className="mt-1 list-disc pl-5 text-amber-900/90">
          <li>{caps?.composioConfiguredHint}</li>
          <li>{caps?.ghlConfiguredHint}</li>
          <li>
            Verified Box toolkit {caps?.boxToolkitVersion}:{" "}
            {caps?.boxTools.join(", ")}
          </li>
        </ul>
      </div>

      <form
        onSubmit={(e) => void onConnectMock(e)}
        className="flex flex-wrap items-end gap-3 rounded border border-slate-200 bg-white p-4"
      >
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-slate-600">Provider</span>
          <select
            className="rounded border border-slate-300 px-3 py-2"
            value={provider}
            onChange={(e) =>
              setProvider(e.target.value as (typeof PROVIDERS)[number])
            }
            disabled={!canAdmin}
          >
            {PROVIDERS.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>
        </label>
        <button
          type="submit"
          disabled={!canAdmin}
          className="rounded bg-slate-900 px-4 py-2 text-sm text-white disabled:bg-slate-400"
        >
          Connect MOCK
        </button>
        {!canAdmin ? (
          <p className="w-full text-sm text-amber-800">
            Admin role required to manage connections.
          </p>
        ) : null}
      </form>

      <form
        onSubmit={(e) => void onAttachLive(e)}
        className="space-y-3 rounded border border-slate-200 bg-white p-4"
      >
        <p className="text-sm font-medium text-slate-800">
          Attach live Composio credential reference
        </p>
        <p className="text-xs text-slate-500">
          Stores only the managed connected-account id — never raw OAuth tokens.
          Requires COMPOSIO_API_KEY on Convex env.
        </p>
        <div className="flex flex-wrap gap-3">
          <label className="flex min-w-[200px] flex-1 flex-col gap-1 text-sm">
            <span className="text-slate-600">Connection id</span>
            <input
              className="rounded border border-slate-300 px-3 py-2 font-mono text-xs"
              value={liveConnectionId}
              onChange={(e) => setLiveConnectionId(e.target.value)}
              placeholder="from table below"
              disabled={!canAdmin}
              required
            />
          </label>
          <label className="flex min-w-[200px] flex-1 flex-col gap-1 text-sm">
            <span className="text-slate-600">Composio connected account id</span>
            <input
              className="rounded border border-slate-300 px-3 py-2 font-mono text-xs"
              value={managedRef}
              onChange={(e) => setManagedRef(e.target.value)}
              disabled={!canAdmin}
              required
            />
          </label>
          <label className="flex min-w-[160px] flex-1 flex-col gap-1 text-sm">
            <span className="text-slate-600">Composio user id</span>
            <input
              className="rounded border border-slate-300 px-3 py-2 font-mono text-xs"
              value={composioUserId}
              onChange={(e) => setComposioUserId(e.target.value)}
              disabled={!canAdmin}
              required
            />
          </label>
          <button
            type="submit"
            disabled={!canAdmin}
            className="self-end rounded border border-slate-900 px-4 py-2 text-sm disabled:opacity-50"
          >
            Attach live ref
          </button>
        </div>
      </form>

      {error ? <p className="text-sm text-red-700">{error}</p> : null}
      {message ? (
        <p className="text-sm text-emerald-800">{message}</p>
      ) : null}

      <section className="space-y-2">
        <h2 className="text-lg font-medium">Needs reconnect / renew</h2>
        {(needingAttention ?? []).length === 0 ? (
          <p className="text-sm text-slate-500">Nothing needs attention.</p>
        ) : (
          <ul className="divide-y divide-slate-100 rounded border border-amber-200 bg-amber-50/40">
            {(needingAttention ?? []).map((c) => (
              <li
                key={c._id}
                className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 text-sm"
              >
                <div>
                  <p className="font-medium">
                    {c.provider} · {c.displayName}{" "}
                    <span className="text-xs uppercase text-amber-900">
                      {c.health}
                    </span>
                  </p>
                  <p className="text-xs text-amber-900">{c.reason}</p>
                </div>
                {canAdmin ? (
                  <button
                    type="button"
                    className="rounded border border-slate-900 px-3 py-1 text-xs"
                    onClick={() =>
                      void acknowledgeReconnected({
                        organizationId,
                        connectionId: c._id,
                      })
                        .then(() =>
                          setMessage(`Acknowledged reconnect: ${c.displayName}`),
                        )
                        .catch((err: unknown) =>
                          setError(
                            err instanceof Error
                              ? err.message
                              : "Ack reconnect failed",
                          ),
                        )
                    }
                  >
                    Acknowledge reconnect
                  </button>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </section>

      {!connections ? (
        <p className="text-sm text-slate-500">Loading…</p>
      ) : connections.length === 0 ? (
        <p className="text-sm text-slate-500">No active connections.</p>
      ) : (
        <table className="w-full overflow-hidden rounded border border-slate-200 bg-white text-left text-sm">
          <thead className="bg-slate-50 text-slate-600">
            <tr>
              <th className="px-3 py-2 font-medium">Provider</th>
              <th className="px-3 py-2 font-medium">Label</th>
              <th className="px-3 py-2 font-medium">Mode</th>
              <th className="px-3 py-2 font-medium">Health</th>
              <th className="px-3 py-2 font-medium">Renew</th>
              <th className="px-3 py-2 font-medium">Id</th>
              <th className="px-3 py-2 font-medium" />
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {connections.map((c) => (
              <tr key={c._id}>
                <td className="px-3 py-2 uppercase tracking-wide text-xs">
                  {c.provider}
                </td>
                <td className="px-3 py-2">{c.displayName}</td>
                <td className="px-3 py-2">
                  <span
                    className={
                      c.mode === "mock"
                        ? "rounded bg-amber-100 px-1.5 py-0.5 text-xs text-amber-900"
                        : "rounded bg-emerald-100 px-1.5 py-0.5 text-xs text-emerald-900"
                    }
                  >
                    {c.mode.toUpperCase()}
                  </span>
                </td>
                <td className="px-3 py-2 text-xs uppercase">{c.health}</td>
                <td className="px-3 py-2 font-mono text-xs text-slate-500">
                  {c.renewAfterAt
                    ? new Date(c.renewAfterAt).toISOString().slice(0, 10)
                    : "—"}
                </td>
                <td className="px-3 py-2 font-mono text-xs text-slate-500">
                  {c._id}
                </td>
                <td className="px-3 py-2 text-right">
                  <div className="flex flex-wrap justify-end gap-2">
                    <button
                      type="button"
                      className="text-xs text-amber-800 hover:underline"
                      disabled={!canAdmin}
                      onClick={() =>
                        void markNeedsReconnect({
                          organizationId,
                          connectionId: c._id,
                          reason: "Operator flagged reconnect",
                        })
                          .then(() =>
                            setMessage(`Flagged reconnect: ${c.displayName}`),
                          )
                          .catch((err: unknown) =>
                            setError(
                              err instanceof Error
                                ? err.message
                                : "Mark reconnect failed",
                            ),
                          )
                      }
                    >
                      Needs reconnect
                    </button>
                    <button
                      type="button"
                      className="text-xs text-slate-700 hover:underline"
                      disabled={!canAdmin}
                      onClick={() =>
                        void scheduleRenewal({
                          organizationId,
                          connectionId: c._id,
                          watchExpiresAt: Date.now() + 7 * 24 * 60 * 60 * 1000,
                        })
                          .then(() =>
                            setMessage(
                              `Renew window set (+7d) for ${c.displayName}`,
                            ),
                          )
                          .catch((err: unknown) =>
                            setError(
                              err instanceof Error
                                ? err.message
                                : "Schedule renewal failed",
                            ),
                          )
                      }
                    >
                      Set renew +7d
                    </button>
                    <button
                      type="button"
                      className="text-xs text-red-700 hover:underline"
                      disabled={!canAdmin}
                      onClick={() =>
                        void disconnect({
                          organizationId,
                          connectionId: c._id,
                        }).catch((err: unknown) =>
                          setError(
                            err instanceof Error
                              ? err.message
                              : "Disconnect failed",
                          ),
                        )
                      }
                    >
                      Disconnect
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
