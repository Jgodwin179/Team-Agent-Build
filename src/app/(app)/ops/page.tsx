"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useMutation, useQuery } from "convex/react";
import { api } from "../../../../convex/_generated/api";
import { useActiveOrg } from "@/components/AppShell";

export default function OpsPage() {
  const { organizationId, org } = useActiveOrg();
  const canAdmin = org.role === "owner" || org.role === "admin";
  const nowMs = useMemo(() => Date.now(), []);
  const summary = useQuery(api.ops.opsSummary, { organizationId });
  const failedInbound = useQuery(api.ops.listFailedInboundEvents, {
    organizationId,
  });
  const failedRuns = useQuery(api.ops.listFailedRuns, { organizationId });
  const unknownOutbound = useQuery(api.reconcile.listUnknownOutbound, {
    organizationId,
  });
  const needingAttention = useQuery(api.connections.listNeedingAttention, {
    organizationId,
  });
  const retentionPreview = useQuery(api.retention.previewPurge, {
    organizationId,
    nowMs,
  });

  const replay = useMutation(api.ops.replayFailedInbound);
  const markFailedFixture = useMutation(api.ops.markInboundFailedFixture);
  const resolveUnknown = useMutation(api.reconcile.resolveUnknownOutbound);
  const foldUnknowns = useMutation(api.reconcile.foldDryRunUnknowns);
  const runScheduleReconcile = useMutation(api.reconcile.runScheduleReconcile);
  const runPurge = useMutation(api.retention.runPurgeBatch);
  const acknowledge = useMutation(api.connections.acknowledgeReconnected);

  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function withFeedback(fn: () => Promise<void>) {
    setError(null);
    setMessage(null);
    setBusy(true);
    try {
      await fn();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Action failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Operations</h1>
        <p className="mt-1 text-sm text-slate-600">
          Failed events, unknown outbound, connection renewals, retention
          preview, and schedule reconcile. Live provider smoke stays off until
          explicitly authorized.
        </p>
      </div>

      {error ? (
        <p className="rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
          {error}
        </p>
      ) : null}
      {message ? (
        <p className="rounded border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-900">
          {message}
        </p>
      ) : null}

      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {[
          ["Failed inbound", summary?.failedInbound],
          ["Failed runs", summary?.failedRuns],
          ["Unknown outbound", summary?.unknownOutbound],
          ["Connections needing attention", summary?.connectionsNeedingAttention],
          [
            "Schedules enabled",
            summary ? (summary.schedulesEnabled ? "yes" : "no") : "…",
          ],
          [
            "Outbound dry-run",
            summary ? (summary.outboundDryRun ? "yes" : "NO") : "…",
          ],
        ].map(([label, value]) => (
          <div
            key={String(label)}
            className="rounded border border-slate-200 bg-white px-4 py-3"
          >
            <p className="text-xs uppercase tracking-wide text-slate-500">
              {label}
            </p>
            <p className="mt-1 text-2xl font-semibold tabular-nums text-slate-900">
              {value ?? "…"}
            </p>
          </div>
        ))}
      </section>

      <section className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-lg font-medium">Failed inbound events</h2>
          {canAdmin ? (
            <button
              type="button"
              disabled={busy}
              className="rounded border border-slate-300 px-3 py-1.5 text-xs disabled:opacity-50"
              onClick={() =>
                void withFeedback(async () => {
                  const id = await markFailedFixture({ organizationId });
                  setMessage(`Created MOCK failed inbound ${id}`);
                })
              }
            >
              Seed MOCK failure
            </button>
          ) : null}
        </div>
        {(failedInbound ?? []).length === 0 ? (
          <p className="text-sm text-slate-500">No failed inbound events.</p>
        ) : (
          <ul className="divide-y divide-slate-100 rounded border border-slate-200 bg-white">
            {(failedInbound ?? []).map((ev) => (
              <li
                key={ev._id}
                className="flex flex-wrap items-start justify-between gap-3 px-4 py-3 text-sm"
              >
                <div>
                  <p className="font-medium">
                    {ev.provider} · {ev.eventType}
                  </p>
                  <p className="mt-0.5 font-mono text-xs text-slate-500">
                    {ev.providerEventId} · attempts={ev.attempts}
                  </p>
                  <p className="mt-1 text-red-700">
                    {ev.errorMessage ?? "No error message"}
                  </p>
                </div>
                {canAdmin ? (
                  <button
                    type="button"
                    disabled={busy}
                    className="rounded bg-slate-900 px-3 py-1.5 text-xs text-white disabled:bg-slate-400"
                    onClick={() =>
                      void withFeedback(async () => {
                        const result = await replay({
                          organizationId,
                          inboundEventId: ev._id,
                        });
                        setMessage(
                          `Replay ${result.mode}: ${result.detail}${
                            result.runId ? ` (run ${result.runId})` : ""
                          }`,
                        );
                      })
                    }
                  >
                    Safe replay
                  </button>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-medium">Failed runs</h2>
        {(failedRuns ?? []).length === 0 ? (
          <p className="text-sm text-slate-500">No failed runs.</p>
        ) : (
          <ul className="divide-y divide-slate-100 rounded border border-slate-200 bg-white">
            {(failedRuns ?? []).map((run) => (
              <li
                key={run._id}
                className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 text-sm"
              >
                <div>
                  <p className="font-medium">{run.title}</p>
                  <p className="text-xs text-slate-500">
                    {run.specialistType ?? "coordinator"} ·{" "}
                    {run.errorMessage ?? "failed"}
                  </p>
                </div>
                <Link
                  href={`/runs/${run._id}`}
                  className="text-xs text-slate-800 underline"
                >
                  Open run
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-lg font-medium">Unknown outbound</h2>
          {canAdmin ? (
            <button
              type="button"
              disabled={busy}
              className="rounded border border-slate-300 px-3 py-1.5 text-xs disabled:opacity-50"
              onClick={() =>
                void withFeedback(async () => {
                  const result = await foldUnknowns({ organizationId });
                  setMessage(
                    `Folded ${result.folded} dry-run unknowns; skipped ${result.skippedLive} live`,
                  );
                })
              }
            >
              Fold dry-run unknowns
            </button>
          ) : null}
        </div>
        <p className="text-xs text-slate-500">
          Never auto-resends. Confirm delivery with the provider, then mark sent
          or failed. Live unknowns require operator resolution.
        </p>
        {(unknownOutbound ?? []).length === 0 ? (
          <p className="text-sm text-slate-500">No unknown outbound actions.</p>
        ) : (
          <ul className="divide-y divide-slate-100 rounded border border-slate-200 bg-white">
            {(unknownOutbound ?? []).map((row) => (
              <li
                key={row._id}
                className="flex flex-wrap items-start justify-between gap-3 px-4 py-3 text-sm"
              >
                <div>
                  <p className="font-medium">
                    {row.actionKey} → {row.destination}
                  </p>
                  <p className="font-mono text-xs text-slate-500">
                    {row._id}
                    {row.dryRun ? " · DRY-RUN" : " · LIVE"}
                  </p>
                </div>
                {canAdmin ? (
                  <div className="flex flex-wrap gap-2">
                    {row.dryRun ? (
                      <button
                        type="button"
                        disabled={busy}
                        className="rounded border border-slate-300 px-2 py-1 text-xs"
                        onClick={() =>
                          void withFeedback(async () => {
                            const r = await resolveUnknown({
                              organizationId,
                              outboundActionId: row._id,
                              resolution: "mark_dry_run",
                            });
                            setMessage(r.detail);
                          })
                        }
                      >
                        Mark dry-run
                      </button>
                    ) : null}
                    <button
                      type="button"
                      disabled={busy}
                      className="rounded border border-slate-300 px-2 py-1 text-xs"
                      onClick={() =>
                        void withFeedback(async () => {
                          const r = await resolveUnknown({
                            organizationId,
                            outboundActionId: row._id,
                            resolution: "mark_failed",
                            note: "Operator confirmed no delivery",
                          });
                          setMessage(r.detail);
                        })
                      }
                    >
                      Mark failed
                    </button>
                    <button
                      type="button"
                      disabled={busy}
                      className="rounded border border-slate-300 px-2 py-1 text-xs"
                      onClick={() =>
                        void withFeedback(async () => {
                          const r = await resolveUnknown({
                            organizationId,
                            outboundActionId: row._id,
                            resolution: "mark_sent",
                            note: "Operator confirmed provider delivery",
                          });
                          setMessage(r.detail);
                        })
                      }
                    >
                      Mark sent
                    </button>
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-medium">Connections needing attention</h2>
        {(needingAttention ?? []).length === 0 ? (
          <p className="text-sm text-slate-500">All connections healthy.</p>
        ) : (
          <ul className="divide-y divide-slate-100 rounded border border-slate-200 bg-white">
            {(needingAttention ?? []).map((c) => (
              <li
                key={c._id}
                className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 text-sm"
              >
                <div>
                  <p className="font-medium">
                    {c.provider} · {c.displayName}
                  </p>
                  <p className="text-xs text-amber-800">{c.reason}</p>
                  {c.watchExpiresAt ? (
                    <p className="font-mono text-xs text-slate-500">
                      watch expires{" "}
                      {new Date(c.watchExpiresAt).toISOString()}
                    </p>
                  ) : null}
                </div>
                <div className="flex gap-2">
                  <Link
                    href="/connections"
                    className="text-xs underline text-slate-800"
                  >
                    Manage
                  </Link>
                  {canAdmin && c.mode === "mock" ? (
                    <button
                      type="button"
                      disabled={busy}
                      className="rounded border border-slate-300 px-2 py-1 text-xs"
                      onClick={() =>
                        void withFeedback(async () => {
                          await acknowledge({
                            organizationId,
                            connectionId: c._id,
                          });
                          setMessage(`Acknowledged reconnect for ${c.displayName}`);
                        })
                      }
                    >
                      Ack reconnect (MOCK)
                    </button>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        )}
        {canAdmin ? (
          <p className="text-xs text-slate-500">
            Use Connections to attach a managed credential ref, then acknowledge
            reconnect. See Connections → “Mark needs reconnect” / renew window.
          </p>
        ) : null}
      </section>

      <section className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-lg font-medium">Schedule reconcile</h2>
          {canAdmin ? (
            <button
              type="button"
              disabled={busy}
              className="rounded bg-slate-900 px-3 py-1.5 text-xs text-white disabled:bg-slate-400"
              onClick={() =>
                void withFeedback(async () => {
                  const result = await runScheduleReconcile({
                    organizationId,
                    nowMs: Date.now(),
                  });
                  setMessage(
                    `Schedules checked=${result.schedulesChecked} fired=${result.fired} skipped=${result.skipped}`,
                  );
                })
              }
            >
              Run reconcile now
            </button>
          ) : null}
        </div>
        <p className="text-xs text-slate-500">
          Cron every 15m when org schedulesEnabled. Requires schedules enabled
          for this org. Does not enable live outbound.
        </p>
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-medium">Retention / deletion</h2>
        {!retentionPreview ? (
          <p className="text-sm text-slate-500">Loading preview…</p>
        ) : (
          <div className="rounded border border-slate-200 bg-white p-4 text-sm">
            <p>
              Candidates (days: audit={retentionPreview.retentionDaysAudit},
              usage={retentionPreview.retentionDaysUsage}, inbound=
              {retentionPreview.retentionDaysInboundSucceeded}):{" "}
              <strong>{retentionPreview.candidateAudit}</strong> audit,{" "}
              <strong>{retentionPreview.candidateUsage}</strong> usage,{" "}
              <strong>{retentionPreview.candidateInboundSucceeded}</strong>{" "}
              succeeded inbound.
            </p>
            <p className="mt-2 text-xs text-slate-500">
              Never auto-deleted:{" "}
              {retentionPreview.neverAutoDeleted.join(", ")}.
            </p>
            {canAdmin ? (
              <div className="mt-3 flex flex-wrap gap-2">
                <button
                  type="button"
                  disabled={busy}
                  className="rounded border border-slate-300 px-3 py-1.5 text-xs"
                  onClick={() =>
                    void withFeedback(async () => {
                      const r = await runPurge({
                        organizationId,
                        nowMs: Date.now(),
                        execute: false,
                      });
                      setMessage(
                        `Dry-run purge would delete audit=${r.deletedAudit} usage=${r.deletedUsage} inbound=${r.deletedInbound}`,
                      );
                    })
                  }
                >
                  Preview purge batch
                </button>
                <button
                  type="button"
                  disabled={busy}
                  className="rounded border border-red-300 px-3 py-1.5 text-xs text-red-800"
                  onClick={() =>
                    void withFeedback(async () => {
                      const ok = window.confirm(
                        "Permanently delete eligible audit/usage/succeeded-inbound rows in this batch?",
                      );
                      if (!ok) return;
                      const r = await runPurge({
                        organizationId,
                        nowMs: Date.now(),
                        execute: true,
                      });
                      setMessage(
                        `Purged audit=${r.deletedAudit} usage=${r.deletedUsage} inbound=${r.deletedInbound}`,
                      );
                    })
                  }
                >
                  Execute purge batch
                </button>
              </div>
            ) : null}
          </div>
        )}
      </section>
    </div>
  );
}
