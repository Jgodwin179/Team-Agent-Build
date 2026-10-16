"use client";

import { FormEvent, useState } from "react";
import { useAction, useMutation, useQuery } from "convex/react";
import { useRouter } from "next/navigation";
import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";
import { useActiveOrg } from "@/components/AppShell";

export default function AssignmentsPage() {
  const router = useRouter();
  const { organizationId, org } = useActiveOrg();
  const deals = useQuery(api.deals.list, { organizationId });
  const submit = useMutation(api.assignments.submit);
  const getModelMode = useAction(api.agents.researchAgent.getModelMode);
  const [title, setTitle] = useState("");
  const [prompt, setPrompt] = useState(
    "Summarize open deals and propose next research steps for the assigned broker.",
  );
  const [dealId, setDealId] = useState<Id<"deals"> | "">("");
  const [error, setError] = useState<string | null>(null);
  const [modelLabel, setModelLabel] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const canWrite = org.role !== "viewer";

  async function refreshModelLabel() {
    try {
      const mode = await getModelMode({});
      setModelLabel(mode.label);
    } catch {
      setModelLabel("Unable to resolve model mode");
    }
  }

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    if (!canWrite) {
      setError("Viewers cannot submit assignments.");
      return;
    }
    setPending(true);
    try {
      const result = await submit({
        organizationId,
        title,
        prompt,
        dealId: dealId || undefined,
      });
      setTitle("");
      router.push(`/runs/${result.runId}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Submit failed");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Assignments</h1>
        <p className="mt-1 text-sm text-slate-600">
          Submit a web assignment → inbound event → durable workflow → bounded
          agent with a read-only tool → live run result.
        </p>
      </div>

      <div className="rounded border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-950">
        <p className="font-medium">Model mode</p>
        <p className="mt-1">
          {modelLabel ??
            "Defaults to MOCK unless USE_AI_GATEWAY=true on Convex."}
        </p>
        <button
          type="button"
          className="mt-2 underline"
          onClick={() => void refreshModelLabel()}
        >
          Refresh model label
        </button>
      </div>

      <form
        onSubmit={(e) => void onSubmit(e)}
        className="space-y-3 rounded border border-slate-200 bg-white p-4"
      >
        <label className="block text-sm">
          <span className="text-slate-600">Title</span>
          <input
            className="mt-1 w-full rounded border border-slate-300 px-3 py-2"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            required
            disabled={!canWrite || pending}
            placeholder="e.g. Prep Midwest Manufacturing brief"
          />
        </label>
        <label className="block text-sm">
          <span className="text-slate-600">Instructions</span>
          <textarea
            className="mt-1 w-full rounded border border-slate-300 px-3 py-2"
            rows={4}
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            required
            disabled={!canWrite || pending}
          />
        </label>
        <label className="block text-sm">
          <span className="text-slate-600">Deal (optional)</span>
          <select
            className="mt-1 w-full rounded border border-slate-300 px-3 py-2"
            value={dealId}
            onChange={(e) => setDealId(e.target.value as Id<"deals"> | "")}
            disabled={!canWrite || pending}
          >
            <option value="">None</option>
            {deals?.map((deal) => (
              <option key={deal._id} value={deal._id}>
                {deal.title}
              </option>
            ))}
          </select>
        </label>
        {error ? <p className="text-sm text-red-700">{error}</p> : null}
        <button
          type="submit"
          disabled={!canWrite || pending}
          className="rounded bg-slate-900 px-4 py-2 text-sm text-white disabled:bg-slate-400"
        >
          {pending ? "Starting workflow…" : "Submit assignment"}
        </button>
      </form>
    </div>
  );
}
