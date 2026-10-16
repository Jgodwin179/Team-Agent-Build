"use client";

import Link from "next/link";
import { FormEvent, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";
import { useActiveOrg } from "@/components/AppShell";

export default function RunsPage() {
  const { organizationId, org } = useActiveOrg();
  const runs = useQuery(api.runs.list, { organizationId });
  const deals = useQuery(api.deals.list, { organizationId });
  const createQueued = useMutation(api.runs.createQueued);
  const requestCancel = useMutation(api.runs.requestCancel);
  const [title, setTitle] = useState("");
  const [dealId, setDealId] = useState<Id<"deals"> | "">("");
  const [error, setError] = useState<string | null>(null);
  const canWrite = org.role !== "viewer";

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    if (!canWrite) {
      setError("Viewers cannot queue runs.");
      return;
    }
    try {
      await createQueued({
        organizationId,
        title,
        dealId: dealId || undefined,
      });
      setTitle("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to queue run");
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Runs</h1>
        <p className="mt-1 text-sm text-slate-600">
          Durable run records (queued → running → terminal). Agent/workflow
          execution arrives in Phase 2.
        </p>
      </div>

      <form
        onSubmit={(e) => void onSubmit(e)}
        className="flex flex-wrap items-end gap-3 rounded border border-slate-200 bg-white p-4"
      >
        <label className="flex min-w-[220px] flex-1 flex-col gap-1 text-sm">
          <span className="text-slate-600">Title</span>
          <input
            className="rounded border border-slate-300 px-3 py-2"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Assignment title"
            required
            disabled={!canWrite}
          />
        </label>
        <label className="flex min-w-[180px] flex-col gap-1 text-sm">
          <span className="text-slate-600">Deal (optional)</span>
          <select
            className="rounded border border-slate-300 px-3 py-2"
            value={dealId}
            onChange={(e) =>
              setDealId(e.target.value as Id<"deals"> | "")
            }
            disabled={!canWrite}
          >
            <option value="">None</option>
            {deals?.map((deal) => (
              <option key={deal._id} value={deal._id}>
                {deal.title}
              </option>
            ))}
          </select>
        </label>
        <button
          type="submit"
          disabled={!canWrite}
          className="rounded bg-slate-900 px-4 py-2 text-sm text-white disabled:cursor-not-allowed disabled:bg-slate-400"
        >
          Queue run
        </button>
        {error ? <p className="w-full text-sm text-red-700">{error}</p> : null}
      </form>

      {!runs ? (
        <p className="text-sm text-slate-500">Loading…</p>
      ) : runs.length === 0 ? (
        <p className="text-sm text-slate-500">No runs yet.</p>
      ) : (
        <table className="w-full overflow-hidden rounded border border-slate-200 bg-white text-left text-sm">
          <thead className="bg-slate-50 text-slate-600">
            <tr>
              <th className="px-3 py-2 font-medium">Title</th>
              <th className="px-3 py-2 font-medium">Status</th>
              <th className="px-3 py-2 font-medium">Budget</th>
              <th className="px-3 py-2 font-medium">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {runs.map((run) => (
              <tr key={run._id}>
                <td className="px-3 py-2">
                  <Link href={`/runs/${run._id}`} className="underline">
                    {run.title}
                  </Link>
                </td>
                <td className="px-3 py-2 text-xs uppercase tracking-wide">
                  {run.status}
                </td>
                <td className="px-3 py-2 text-slate-500">
                  {run.usedTokens ?? 0}/{run.budgetTokens ?? "—"}
                </td>
                <td className="px-3 py-2">
                  {canWrite &&
                  !["succeeded", "failed", "canceled"].includes(run.status) ? (
                    <button
                      type="button"
                      className="text-sm text-red-700 underline"
                      onClick={() =>
                        void requestCancel({
                          organizationId,
                          runId: run._id,
                        }).catch((err: unknown) =>
                          setError(
                            err instanceof Error
                              ? err.message
                              : "Cancel failed",
                          ),
                        )
                      }
                    >
                      Request cancel
                    </button>
                  ) : (
                    <span className="text-slate-400">—</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
