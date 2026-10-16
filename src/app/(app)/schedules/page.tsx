"use client";

import { FormEvent, useMemo, useState } from "react";
import Link from "next/link";
import { useMutation, useQuery } from "convex/react";
import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";
import { useActiveOrg } from "@/components/AppShell";

export default function SchedulesPage() {
  const { organizationId, org } = useActiveOrg();
  const flags = useQuery(api.schedules.getOrgScheduleFlags, { organizationId });
  const schedules = useQuery(api.schedules.list, { organizationId });
  const eventRules = useQuery(api.eventRules.list, { organizationId });
  const createSchedule = useMutation(api.schedules.create);
  const setEnabled = useMutation(api.schedules.setEnabled);
  const setOrgEnabled = useMutation(api.schedules.setOrgSchedulesEnabled);
  const runNow = useMutation(api.schedules.runNow);
  const createRule = useMutation(api.eventRules.create);
  const fireFixture = useMutation(api.eventRules.fireFixtureEvent);
  const startCoordinator = useMutation(api.delegation.startCoordinator);

  const [name, setName] = useState("Daily deal digest");
  const [prompt, setPrompt] = useState(
    "Summarize open deals for the brokerage team (dry-run).",
  );
  const [localHour, setLocalHour] = useState(9);
  const [localMinute, setLocalMinute] = useState(0);
  const [recurrence, setRecurrence] = useState<"daily" | "weekly" | "once">(
    "daily",
  );
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<Id<"schedules"> | null>(null);
  const [coordResult, setCoordResult] = useState<string | null>(null);

  const preview = useQuery(api.schedules.previewNext, {
    organizationId,
    timezone: flags?.timezone,
    recurrence,
    localHour,
    localMinute,
    daysOfWeek: recurrence === "weekly" ? [1, 2, 3, 4, 5] : undefined,
    count: 5,
  });

  const occurrences = useQuery(
    api.schedules.listOccurrences,
    selectedId
      ? { organizationId, scheduleId: selectedId }
      : "skip",
  );

  const canAdmin = org.role === "owner" || org.role === "admin";
  const canWrite = org.role !== "viewer";

  const dstNote = useMemo(
    () =>
      "DST: wall-clock in America/New_York (or schedule TZ). Spring-forward gaps skip to the next valid minute; fall-back overlaps use the earlier instant. Keys are local date+time+TZ (one logical fire per wall-clock slot).",
    [],
  );

  async function onCreate(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setMessage(null);
    try {
      const id = await createSchedule({
        organizationId,
        name,
        jobPrompt: prompt,
        recurrence,
        localHour,
        localMinute,
        daysOfWeek: recurrence === "weekly" ? [1, 2, 3, 4, 5] : undefined,
        missedRunPolicy: "skip",
        concurrencyPolicy: "forbid",
        enabled: false,
      });
      setSelectedId(id);
      setMessage(`Created schedule ${id} (disabled by default).`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Create failed");
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Schedules</h1>
        <p className="mt-1 text-sm text-slate-600">
          Configurable schedules + event rules + coordinator delegation.
          Disabled / dry-run by default in development.
        </p>
      </div>

      <div className="rounded border border-amber-200 bg-amber-50 p-3 text-sm text-amber-950">
        <p>
          Org schedulesEnabled:{" "}
          <strong>{flags?.schedulesEnabled ? "ON" : "OFF"}</strong>
          {" · "}
          TZ {flags?.timezone ?? "America/New_York"}
          {" · "}
          Outbound dry-run {flags?.outboundDryRun !== false ? "ON" : "OFF"}
        </p>
        <p className="mt-1 text-xs text-amber-900/90">{dstNote}</p>
        {canAdmin ? (
          <button
            type="button"
            className="mt-2 rounded border border-amber-800 px-3 py-1 text-xs"
            onClick={() =>
              void setOrgEnabled({
                organizationId,
                schedulesEnabled: !flags?.schedulesEnabled,
              }).catch((err: unknown) =>
                setError(err instanceof Error ? err.message : "Failed"),
              )
            }
          >
            {flags?.schedulesEnabled
              ? "Disable org schedules"
              : "Enable org schedules (dev)"}
          </button>
        ) : null}
      </div>

      {error ? (
        <p className="rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
          {error}
        </p>
      ) : null}
      {message ? (
        <p className="rounded border border-slate-200 bg-slate-50 px-3 py-2 text-sm">
          {message}
        </p>
      ) : null}

      <form
        onSubmit={(e) => void onCreate(e)}
        className="space-y-3 rounded border border-slate-200 bg-white p-4"
      >
        <h2 className="font-medium">Create schedule</h2>
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-slate-600">Name</span>
          <input
            className="rounded border border-slate-300 px-3 py-2"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
          />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-slate-600">Job prompt</span>
          <textarea
            className="min-h-[72px] rounded border border-slate-300 px-3 py-2"
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            required
          />
        </label>
        <div className="flex flex-wrap gap-3">
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-slate-600">Recurrence</span>
            <select
              className="rounded border border-slate-300 px-3 py-2"
              value={recurrence}
              onChange={(e) =>
                setRecurrence(e.target.value as "daily" | "weekly" | "once")
              }
            >
              <option value="daily">Daily</option>
              <option value="weekly">Weekdays</option>
              <option value="once">Once</option>
            </select>
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-slate-600">Local hour</span>
            <input
              type="number"
              min={0}
              max={23}
              className="w-24 rounded border border-slate-300 px-3 py-2"
              value={localHour}
              onChange={(e) => setLocalHour(Number(e.target.value))}
            />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-slate-600">Minute</span>
            <input
              type="number"
              min={0}
              max={59}
              className="w-24 rounded border border-slate-300 px-3 py-2"
              value={localMinute}
              onChange={(e) => setLocalMinute(Number(e.target.value))}
            />
          </label>
        </div>
        <div className="rounded bg-slate-50 p-3 text-xs text-slate-600">
          <p className="font-medium text-slate-700">Next-run preview</p>
          <ul className="mt-1 list-disc pl-4">
            {(preview ?? []).map((p) => (
              <li key={p.at}>
                {p.localLabel}{" "}
                <span className="font-mono text-[10px] text-slate-400">
                  ({new Date(p.at).toISOString()})
                </span>
              </li>
            ))}
            {preview && preview.length === 0 ? <li>None</li> : null}
          </ul>
        </div>
        <button
          type="submit"
          disabled={!canAdmin}
          className="rounded bg-slate-900 px-4 py-2 text-sm text-white disabled:opacity-50"
        >
          Create (disabled)
        </button>
      </form>

      <section className="space-y-2">
        <h2 className="text-lg font-medium">Schedules</h2>
        {(schedules ?? []).length === 0 ? (
          <p className="text-sm text-slate-500">No schedules yet.</p>
        ) : (
          <ul className="divide-y divide-slate-200 rounded border border-slate-200 bg-white">
            {(schedules ?? []).map((s) => (
              <li key={s._id} className="space-y-2 px-4 py-3 text-sm">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <p className="font-medium">
                      {s.name}{" "}
                      <span className="text-xs uppercase text-slate-500">
                        {s.enabled ? "enabled" : "disabled"}
                      </span>
                    </p>
                    <p className="text-xs text-slate-500">
                      {s.recurrence} @ {s.localHour}:{String(s.localMinute).padStart(2, "0")}{" "}
                      {s.timezone} · concurrency={s.concurrencyPolicy} · missed=
                      {s.missedRunPolicy}
                    </p>
                    <p className="mt-1 text-xs text-slate-600">
                      Next:{" "}
                      {s.nextOccurrenceAt
                        ? new Date(s.nextOccurrenceAt).toLocaleString()
                        : "—"}
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      className="rounded border border-slate-300 px-2 py-1 text-xs"
                      onClick={() => setSelectedId(s._id)}
                    >
                      History
                    </button>
                    {canAdmin ? (
                      <button
                        type="button"
                        className="rounded border border-slate-300 px-2 py-1 text-xs"
                        onClick={() =>
                          void setEnabled({
                            organizationId,
                            scheduleId: s._id,
                            enabled: !s.enabled,
                          }).catch((err: unknown) =>
                            setError(
                              err instanceof Error ? err.message : "Failed",
                            ),
                          )
                        }
                      >
                        {s.enabled ? "Disable" : "Enable"}
                      </button>
                    ) : null}
                    {canWrite ? (
                      <button
                        type="button"
                        className="rounded bg-slate-900 px-2 py-1 text-xs text-white"
                        onClick={() =>
                          void runNow({
                            organizationId,
                            scheduleId: s._id,
                          })
                            .then((r) =>
                              setMessage(
                                `Manual run: ${r.status} ${r.runId ?? ""} ${r.reason ?? ""}`,
                              ),
                            )
                            .catch((err: unknown) =>
                              setError(
                                err instanceof Error ? err.message : "Failed",
                              ),
                            )
                        }
                      >
                        Run now
                      </button>
                    ) : null}
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
        {selectedId && occurrences ? (
          <div className="rounded border border-slate-200 bg-white p-3 text-xs">
            <p className="font-medium">Occurrences</p>
            <ul className="mt-2 space-y-1">
              {occurrences.map((o) => (
                <li key={o._id}>
                  {o.status} · {o.occurrenceKey}
                  {o.runId ? (
                    <>
                      {" · "}
                      <Link href={`/runs/${o.runId}`} className="underline">
                        run
                      </Link>
                    </>
                  ) : null}
                  {o.skipReason ? ` — ${o.skipReason}` : null}
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </section>

      <section className="space-y-3 rounded border border-slate-200 bg-white p-4">
        <h2 className="font-medium">Event rules</h2>
        <p className="text-sm text-slate-600">
          Matching inbound event types create durable runs.
        </p>
        {canAdmin ? (
          <button
            type="button"
            className="rounded border border-slate-300 px-3 py-1.5 text-sm"
            onClick={() =>
              void createRule({
                organizationId,
                name: "Deal update → research",
                eventType: "deal.updated",
                createRunTitle: "Event: deal.updated",
                createRunPrompt: "Review deal update and draft notes (MOCK).",
                specialistType: "research",
              })
                .then(() => setMessage("Event rule created"))
                .catch((err: unknown) =>
                  setError(err instanceof Error ? err.message : "Failed"),
                )
            }
          >
            Add sample deal.updated rule
          </button>
        ) : null}
        {canWrite ? (
          <button
            type="button"
            className="ml-2 rounded bg-slate-900 px-3 py-1.5 text-sm text-white"
            onClick={() =>
              void fireFixture({
                organizationId,
                eventType: "deal.updated",
                providerEventId: `ui-${Date.now()}`,
              })
                .then((r) =>
                  setMessage(
                    `Fixture event → ${r.runIds.length} run(s); dedupe=${r.deduplicated}`,
                  ),
                )
                .catch((err: unknown) =>
                  setError(err instanceof Error ? err.message : "Failed"),
                )
            }
          >
            Fire fixture event
          </button>
        ) : null}
        <ul className="text-sm text-slate-700">
          {(eventRules ?? []).map((r) => (
            <li key={r._id}>
              {r.name} · {r.eventType} · {r.enabled ? "on" : "off"}
            </li>
          ))}
        </ul>
      </section>

      <section className="space-y-3 rounded border border-slate-200 bg-white p-4">
        <h2 className="font-medium">Coordinator → specialists</h2>
        <p className="text-sm text-slate-600">
          Bounded parallelism, depth/child limits, no recursive delegation.
          Optional child failure → partial result with missing work.
        </p>
        {canWrite ? (
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className="rounded bg-slate-900 px-3 py-1.5 text-sm text-white"
              onClick={() =>
                void startCoordinator({
                  organizationId,
                  title: "Coordinator demo",
                  prompt: "Delegate research + documents (MOCK).",
                  children: [
                    {
                      specialistType: "research",
                      title: "Research brief",
                      prompt: "Gather public facts (MOCK).",
                    },
                    {
                      specialistType: "documents",
                      title: "Doc skim",
                      prompt: "Summarize attached CIM (MOCK).",
                      optional: true,
                      simulateFailure: true,
                    },
                  ],
                })
                  .then((r) => {
                    setCoordResult(
                      `Started ${r.runId} with ${r.childCount} children`,
                    );
                  })
                  .catch((err: unknown) =>
                    setError(err instanceof Error ? err.message : "Failed"),
                  )
              }
            >
              Run coordinator (optional child fails)
            </button>
            <button
              type="button"
              className="rounded border border-slate-300 px-3 py-1.5 text-sm"
              onClick={() =>
                void startCoordinator({
                  organizationId,
                  title: "Budget exhaustion demo",
                  prompt: "Child will exhaust budget.",
                  children: [
                    {
                      specialistType: "crm",
                      title: "CRM lookup",
                      prompt: "Lookup contact",
                      simulateBudgetExhaustion: true,
                      budgetTokens: 500,
                    },
                  ],
                })
                  .then((r) =>
                    setCoordResult(`Budget demo run ${r.runId}`),
                  )
                  .catch((err: unknown) =>
                    setError(err instanceof Error ? err.message : "Failed"),
                  )
              }
            >
              Run budget exhaustion child
            </button>
          </div>
        ) : null}
        {coordResult ? (
          <p className="text-sm">
            {coordResult}{" "}
            <Link href="/runs" className="underline">
              View runs
            </Link>
          </p>
        ) : null}
      </section>
    </div>
  );
}
