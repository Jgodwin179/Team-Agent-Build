"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useMutation, useQuery } from "convex/react";
import { api } from "../../../../../convex/_generated/api";
import type { Id } from "../../../../../convex/_generated/dataModel";
import { useActiveOrg } from "@/components/AppShell";

export default function RunDetailPage() {
  const params = useParams<{ runId: string }>();
  const runId = params.runId as Id<"runs">;
  const { organizationId, org } = useActiveOrg();
  const run = useQuery(api.runs.get, { organizationId, runId });
  const tools = useQuery(api.runs.listToolExecutions, {
    organizationId,
    runId,
  });
  const usage = useQuery(api.runs.listUsage, { organizationId, runId });
  const requestCancel = useMutation(api.runs.requestCancel);
  const resumeFailed = useMutation(api.runs.resumeFailed);
  const canWrite = org.role !== "viewer";

  if (run === undefined) {
    return <p className="text-sm text-slate-500">Loading run…</p>;
  }
  if (run === null) {
    return (
      <div className="space-y-2">
        <p className="text-sm text-red-700">Run not found or unauthorized.</p>
        <Link href="/runs" className="text-sm underline">
          Back to runs
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <Link href="/runs" className="text-sm text-slate-500 underline">
            ← Runs
          </Link>
          <h1 className="mt-2 text-2xl font-semibold tracking-tight">
            {run.title}
          </h1>
          <p className="mt-1 text-sm text-slate-600">
            Status:{" "}
            <span className="uppercase tracking-wide">{run.status}</span>
            {run.modelMode ? (
              <>
                {" "}
                · Model:{" "}
                <span className="font-medium">
                  {run.modelMode === "mock" ? "MOCK" : "GATEWAY"}
                </span>
              </>
            ) : null}
          </p>
        </div>
        <div className="flex gap-2">
          {canWrite &&
          !["succeeded", "failed", "canceled"].includes(run.status) ? (
            <button
              type="button"
              className="rounded border border-red-300 px-3 py-1.5 text-sm text-red-700"
              onClick={() =>
                void requestCancel({ organizationId, runId })
              }
            >
              Request cancel
            </button>
          ) : null}
          {canWrite && run.status === "failed" ? (
            <button
              type="button"
              className="rounded bg-slate-900 px-3 py-1.5 text-sm text-white"
              onClick={() => void resumeFailed({ organizationId, runId })}
            >
              Resume (replay journal)
            </button>
          ) : null}
        </div>
      </div>

      <section className="rounded border border-slate-200 bg-white p-4 text-sm">
        <h2 className="font-medium">Assignment</h2>
        <p className="mt-2 whitespace-pre-wrap text-slate-700">
          {run.assignmentPrompt ?? "—"}
        </p>
      </section>

      <section className="rounded border border-slate-200 bg-white p-4 text-sm">
        <h2 className="font-medium">Result</h2>
        {run.errorMessage ? (
          <p className="mt-2 text-red-700">{run.errorMessage}</p>
        ) : null}
        <p className="mt-2 whitespace-pre-wrap text-slate-700">
          {run.resultSummary ??
            (run.status === "queued" || run.status === "running"
              ? "Waiting for workflow… (live)"
              : "No result yet.")}
        </p>
        <p className="mt-3 text-xs text-slate-500">
          Steps: {(run.completedSteps ?? []).join(" → ") || "—"} · Tokens:{" "}
          {run.usedTokens ?? 0}/{run.budgetTokens ?? "—"} · Max steps:{" "}
          {run.maxSteps ?? "—"}
        </p>
        {run.workflowId ? (
          <p className="mt-1 text-xs text-slate-500">
            Workflow: {run.workflowId}
          </p>
        ) : null}
      </section>

      <section className="rounded border border-slate-200 bg-white p-4 text-sm">
        <h2 className="font-medium">Tool executions</h2>
        {!tools ? (
          <p className="mt-2 text-slate-500">Loading…</p>
        ) : tools.length === 0 ? (
          <p className="mt-2 text-slate-500">None yet.</p>
        ) : (
          <ul className="mt-2 divide-y divide-slate-100">
            {tools.map((tool) => (
              <li key={tool._id} className="py-2">
                <div className="flex justify-between gap-2">
                  <span className="font-medium">
                    {tool.toolName}{" "}
                    <span className="text-xs uppercase text-slate-500">
                      {tool.classification}
                    </span>
                  </span>
                  <span className="text-xs uppercase text-slate-500">
                    {tool.status}
                    {tool.durationMs !== undefined
                      ? ` · ${tool.durationMs}ms`
                      : ""}
                  </span>
                </div>
                <pre className="mt-1 overflow-x-auto rounded bg-slate-50 p-2 text-xs">
                  {tool.resultJson ?? tool.argsJson}
                </pre>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="rounded border border-slate-200 bg-white p-4 text-sm">
        <h2 className="font-medium">Usage</h2>
        {!usage ? (
          <p className="mt-2 text-slate-500">Loading…</p>
        ) : usage.length === 0 ? (
          <p className="mt-2 text-slate-500">No usage records yet.</p>
        ) : (
          <ul className="mt-2 space-y-1">
            {usage.map((row) => (
              <li key={row._id}>
                {row.model}: {row.totalTokens} tokens (in {row.inputTokens} / out{" "}
                {row.outputTokens})
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
