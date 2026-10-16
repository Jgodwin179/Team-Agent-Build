"use client";

import { FormEvent, useState } from "react";
import { useAction, useMutation, useQuery } from "convex/react";
import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";
import { useActiveOrg } from "@/components/AppShell";

export default function ApprovalsPage() {
  const { organizationId, org } = useActiveOrg();
  const ghlConnections = useQuery(api.connections.list, {
    organizationId,
    provider: "ghl",
  });
  const pending = useQuery(api.crm.listPendingApprovals, { organizationId });
  const proposeUpdate = useMutation(api.crm.proposeUpdate);
  const decide = useMutation(api.approvals.decide);
  const executeApproved = useAction(api.approvals.executeApproved);
  const getContact = useAction(api.crm.getContact);
  const listOpportunities = useAction(api.crm.listOpportunities);

  const [connectionId, setConnectionId] = useState<Id<"connections"> | "">("");
  const [contactId, setContactId] = useState("mock-contact-1");
  const [noteBody, setNoteBody] = useState(
    "CIM intake summary ready for broker review (citations attached in app).",
  );
  const [readResult, setReadResult] = useState<string | null>(null);
  const [execResult, setExecResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const canWrite = org.role !== "viewer";

  async function onPropose(event: FormEvent) {
    event.preventDefault();
    setError(null);
    try {
      await proposeUpdate({
        organizationId,
        actionType: "ghl.add_note",
        contactId,
        noteBody,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Propose failed");
    }
  }

  async function onRead() {
    setError(null);
    setReadResult(null);
    if (!connectionId) {
      setError("Select a GHL connection (create MOCK on Connections).");
      return;
    }
    try {
      const contact = await getContact({
        organizationId,
        connectionId,
        contactId,
      });
      const opps = await listOpportunities({
        organizationId,
        connectionId,
        limit: 10,
      });
      setReadResult(
        JSON.stringify(
          {
            contact,
            opportunities: opps,
          },
          null,
          2,
        ),
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Read failed");
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">
          Approvals / GHL
        </h1>
        <p className="mt-1 text-sm text-slate-600">
          Read CRM data, propose updates, approve, then execute in dry-run only.
          No live CRM writes in Phase 3.
        </p>
      </div>

      <div className="rounded border border-amber-200 bg-amber-50 p-3 text-sm text-amber-950">
        Outbound dry-run is {org.outboundDryRun !== false ? "ON" : "OFF"}.
        Execute always records dry-run receipts unless explicitly authorized
        later.
      </div>

      <div className="flex flex-wrap items-end gap-3 rounded border border-slate-200 bg-white p-4">
        <label className="flex min-w-[220px] flex-1 flex-col gap-1 text-sm">
          <span className="text-slate-600">GHL connection</span>
          <select
            className="rounded border border-slate-300 px-3 py-2"
            value={connectionId}
            onChange={(e) =>
              setConnectionId(e.target.value as Id<"connections"> | "")
            }
          >
            <option value="">Select…</option>
            {(ghlConnections ?? []).map((c) => (
              <option key={c._id} value={c._id}>
                {c.displayName} ({c.mode})
              </option>
            ))}
          </select>
        </label>
        <label className="flex min-w-[160px] flex-col gap-1 text-sm">
          <span className="text-slate-600">Contact id</span>
          <input
            className="rounded border border-slate-300 px-3 py-2 font-mono text-xs"
            value={contactId}
            onChange={(e) => setContactId(e.target.value)}
          />
        </label>
        <button
          type="button"
          onClick={() => void onRead()}
          className="rounded border border-slate-900 px-4 py-2 text-sm"
        >
          Read contact + opps
        </button>
      </div>

      {readResult ? (
        <pre className="max-h-64 overflow-auto rounded border border-slate-200 bg-slate-50 p-3 text-xs">
          {readResult}
        </pre>
      ) : null}

      <form
        onSubmit={(e) => void onPropose(e)}
        className="space-y-3 rounded border border-slate-200 bg-white p-4"
      >
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-slate-600">Proposed note body</span>
          <textarea
            className="min-h-[80px] rounded border border-slate-300 px-3 py-2"
            value={noteBody}
            onChange={(e) => setNoteBody(e.target.value)}
            disabled={!canWrite}
            required
          />
        </label>
        <button
          type="submit"
          disabled={!canWrite}
          className="rounded bg-slate-900 px-4 py-2 text-sm text-white disabled:bg-slate-400"
        >
          Propose GHL note (no write)
        </button>
      </form>

      {error ? <p className="text-sm text-red-700">{error}</p> : null}
      {execResult ? (
        <p className="rounded border border-slate-200 bg-slate-50 px-3 py-2 text-sm">
          {execResult}
        </p>
      ) : null}

      <div>
        <h2 className="text-lg font-medium">Pending approvals</h2>
        {!pending ? (
          <p className="text-sm text-slate-500">Loading…</p>
        ) : pending.length === 0 ? (
          <p className="mt-2 text-sm text-slate-500">None pending.</p>
        ) : (
          <ul className="mt-2 space-y-3">
            {pending.map((item) => (
              <li
                key={item._id}
                className="rounded border border-slate-200 bg-white p-4 text-sm"
              >
                <p className="font-medium">{item.actionType}</p>
                <p className="mt-1 text-slate-700">{item.summary}</p>
                <p className="mt-1 font-mono text-xs text-slate-500">
                  hash {item.actionPayloadHash}
                </p>
                <pre className="mt-2 max-h-32 overflow-auto rounded bg-slate-50 p-2 text-xs">
                  {item.actionPayloadJson}
                </pre>
                <p className="mt-2 text-xs uppercase tracking-wide text-slate-500">
                  status: {item.status}
                </p>
                <div className="mt-3 flex flex-wrap gap-2">
                  {item.status === "pending" ? (
                    <>
                      <button
                        type="button"
                        disabled={!canWrite}
                        className="rounded bg-emerald-800 px-3 py-1.5 text-xs text-white disabled:opacity-50"
                        onClick={() =>
                          void decide({
                            organizationId,
                            approvalId: item._id,
                            decision: "approved",
                            expectedPayloadHash: item.actionPayloadHash,
                          }).catch((err: unknown) =>
                            setError(
                              err instanceof Error
                                ? err.message
                                : "Approve failed",
                            ),
                          )
                        }
                      >
                        Approve
                      </button>
                      <button
                        type="button"
                        disabled={!canWrite}
                        className="rounded border border-slate-300 px-3 py-1.5 text-xs disabled:opacity-50"
                        onClick={() =>
                          void decide({
                            organizationId,
                            approvalId: item._id,
                            decision: "rejected",
                            expectedPayloadHash: item.actionPayloadHash,
                          }).catch((err: unknown) =>
                            setError(
                              err instanceof Error
                                ? err.message
                                : "Reject failed",
                            ),
                          )
                        }
                      >
                        Reject
                      </button>
                    </>
                  ) : null}
                  {item.status === "approved" ? (
                    <button
                      type="button"
                      disabled={!canWrite}
                      className="rounded border border-amber-700 px-3 py-1.5 text-xs text-amber-900 disabled:opacity-50"
                      onClick={() =>
                        void (async () => {
                          setError(null);
                          try {
                            const result = await executeApproved({
                              organizationId,
                              approvalId: item._id,
                            });
                            setExecResult(
                              `Execute: ${result.status} dryRun=${result.dryRun} — ${result.detail}`,
                            );
                          } catch (err) {
                            setError(
                              err instanceof Error
                                ? err.message
                                : "Execute failed",
                            );
                          }
                        })()
                      }
                    >
                      Dry-run execute
                    </button>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
