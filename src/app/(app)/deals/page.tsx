"use client";

import { FormEvent, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "../../../../convex/_generated/api";
import { useActiveOrg } from "@/components/AppShell";

export default function DealsPage() {
  const { organizationId, org } = useActiveOrg();
  const deals = useQuery(api.deals.list, { organizationId });
  const createDeal = useMutation(api.deals.create);
  const [title, setTitle] = useState("");
  const [error, setError] = useState<string | null>(null);
  const canWrite = org.role !== "viewer";

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    if (!canWrite) {
      setError("Viewers cannot create deals.");
      return;
    }
    try {
      await createDeal({ organizationId, title });
      setTitle("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create deal");
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Deals</h1>
        <p className="mt-1 text-sm text-slate-600">
          Organization-scoped deal records. Access is enforced server-side.
        </p>
      </div>

      <form
        onSubmit={(e) => void onSubmit(e)}
        className="flex flex-wrap items-end gap-3 rounded border border-slate-200 bg-white p-4"
      >
        <label className="flex min-w-[240px] flex-1 flex-col gap-1 text-sm">
          <span className="text-slate-600">Title</span>
          <input
            className="rounded border border-slate-300 px-3 py-2"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Seller / opportunity name"
            required
            disabled={!canWrite}
          />
        </label>
        <button
          type="submit"
          disabled={!canWrite}
          className="rounded bg-slate-900 px-4 py-2 text-sm text-white disabled:cursor-not-allowed disabled:bg-slate-400"
        >
          Create deal
        </button>
        {error ? <p className="w-full text-sm text-red-700">{error}</p> : null}
        {!canWrite ? (
          <p className="w-full text-sm text-amber-800">
            Viewer role — write actions are disabled.
          </p>
        ) : null}
      </form>

      {!deals ? (
        <p className="text-sm text-slate-500">Loading…</p>
      ) : deals.length === 0 ? (
        <p className="text-sm text-slate-500">No deals yet.</p>
      ) : (
        <table className="w-full overflow-hidden rounded border border-slate-200 bg-white text-left text-sm">
          <thead className="bg-slate-50 text-slate-600">
            <tr>
              <th className="px-3 py-2 font-medium">Title</th>
              <th className="px-3 py-2 font-medium">Status</th>
              <th className="px-3 py-2 font-medium">Updated</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {deals.map((deal) => (
              <tr key={deal._id}>
                <td className="px-3 py-2">{deal.title}</td>
                <td className="px-3 py-2 uppercase tracking-wide text-xs">
                  {deal.status}
                </td>
                <td className="px-3 py-2 text-slate-500">
                  {new Date(deal.updatedAt).toLocaleString()}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
