"use client";

import { FormEvent, useState } from "react";
import Link from "next/link";
import { useAction, useMutation, useQuery } from "convex/react";
import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";
import { useActiveOrg } from "@/components/AppShell";

export default function PovPage() {
  const { organizationId, org } = useActiveOrg();
  const deals = useQuery(api.deals.list, { organizationId });
  const outbound = useQuery(api.outbound.listForOrg, { organizationId });
  const startFlow = useMutation(api.pov.startSellerPdfFlow);
  const decide = useMutation(api.approvals.decide);
  const executeApproved = useAction(api.approvals.executeApproved);
  const [subject, setSubject] = useState("");
  const [forceAmbiguous, setForceAmbiguous] = useState(false);
  const [notifyPhone, setNotifyPhone] = useState("+15555550199");
  const [result, setResult] = useState<{
    runId: Id<"runs">;
    association: string;
    deduplicated: boolean;
    workflowId: string;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [execResult, setExecResult] = useState<string | null>(null);
  const canWrite = org.role !== "viewer";

  const flowStatus = useQuery(
    api.pov.getFlowStatus,
    result
      ? { organizationId, runId: result.runId }
      : "skip",
  );
  const approvalDetail = useQuery(
    api.approvals.get,
    flowStatus?.approvalId
      ? { organizationId, approvalId: flowStatus.approvalId }
      : "skip",
  );

  async function onStart(event: FormEvent) {
    event.preventDefault();
    setError(null);
    try {
      const started = await startFlow({
        organizationId,
        subject: subject || undefined,
        forceAmbiguous: forceAmbiguous || undefined,
        notifyPhone,
      });
      setResult({
        runId: started.runId,
        association: started.association,
        deduplicated: started.deduplicated,
        workflowId: started.workflowId,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Start failed");
    }
  }

  async function onDuplicate() {
    if (!result) return;
    setError(null);
    const providerEventId = `dup-test-${result.runId}`;
    try {
      await startFlow({
        organizationId,
        subject: subject || undefined,
        forceAmbiguous: forceAmbiguous || undefined,
        notifyPhone,
        providerEventId,
      });
      const dup = await startFlow({
        organizationId,
        subject: subject || undefined,
        providerEventId,
      });
      setResult({
        runId: dup.runId,
        association: dup.association,
        deduplicated: dup.deduplicated,
        workflowId: dup.workflowId,
      });
      if (!dup.deduplicated) {
        setError("Expected deduplicated=true on second delivery");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Duplicate test failed");
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">
          Seller PDF proof-of-value
        </h1>
        <p className="mt-1 text-sm text-slate-600">
          Dry-run E2E: inbound email PDF → org/deal association → document
          specialist → GHL propose → inbox + optional SMS secure link → approve
          exact payload → execute dry-run.
        </p>
      </div>

      <div className="rounded border border-amber-200 bg-amber-50 p-3 text-sm text-amber-950">
        AgentMail + Twilio are labeled MOCK/DRY-RUN when credentials or{" "}
        <code className="font-mono text-xs">ALLOW_LIVE_OUTBOUND</code> are
        missing. No live email/SMS/CRM in this flow.
      </div>

      <form
        onSubmit={onStart}
        className="space-y-3 rounded border border-slate-200 bg-white p-4"
      >
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-slate-600">Subject (optional)</span>
          <input
            className="rounded border border-slate-300 px-3 py-2"
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            placeholder={
              deals?.[0]
                ? `${deals[0].title} — CIM attached`
                : "Seller CIM PDF"
            }
          />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-slate-600">Staff notify phone (SMS dry-run)</span>
          <input
            className="rounded border border-slate-300 px-3 py-2 font-mono text-xs"
            value={notifyPhone}
            onChange={(e) => setNotifyPhone(e.target.value)}
          />
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={forceAmbiguous}
            onChange={(e) => setForceAmbiguous(e.target.checked)}
          />
          Force ambiguous association (review required)
        </label>
        <div className="flex flex-wrap gap-2">
          <button
            type="submit"
            disabled={!canWrite}
            className="rounded bg-slate-900 px-4 py-2 text-sm text-white disabled:opacity-50"
          >
            Start POV dry-run
          </button>
          {result ? (
            <button
              type="button"
              className="rounded border border-slate-300 px-4 py-2 text-sm"
              onClick={() => void onDuplicate()}
            >
              Replay duplicate delivery
            </button>
          ) : null}
        </div>
      </form>

      {error ? (
        <p className="rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
          {error}
        </p>
      ) : null}

      {result ? (
        <div className="space-y-2 rounded border border-slate-200 bg-white p-4 text-sm">
          <p>
            <span className="font-medium">Started.</span> association=
            {result.association}
            {result.deduplicated ? " · DEDUPLICATED" : ""}
          </p>
          <p className="font-mono text-xs text-slate-500">
            run={result.runId} · workflow={result.workflowId}
          </p>
          {flowStatus ? (
            <p>
              Status: {flowStatus.runStatus}
              {flowStatus.approvalId
                ? ` · approval=${flowStatus.approvalId}`
                : ""}
              {` · inboxItems=${flowStatus.inboxCount}`}
            </p>
          ) : (
            <p className="text-slate-500">Loading flow status…</p>
          )}
          <div className="flex flex-wrap gap-3 pt-1">
            <Link
              href={`/runs/${result.runId}`}
              className="underline"
            >
              Open run
            </Link>
            <Link href="/inbox" className="underline">
              Inbox
            </Link>
            {flowStatus?.approvalId ? (
              <Link
                href={`/approvals?approvalId=${flowStatus.approvalId}`}
                className="underline"
              >
                Approvals page
              </Link>
            ) : null}
          </div>
          {approvalDetail ? (
            <div className="mt-3 space-y-2 rounded border border-slate-100 bg-slate-50 p-3">
              <p className="text-xs uppercase tracking-wide text-slate-500">
                Approval · {approvalDetail.status}
              </p>
              <pre className="max-h-28 overflow-auto text-xs">
                {approvalDetail.actionPayloadJson}
              </pre>
              <div className="flex flex-wrap gap-2">
                {approvalDetail.status === "pending" && canWrite ? (
                  <button
                    type="button"
                    className="rounded bg-emerald-800 px-3 py-1.5 text-xs text-white"
                    onClick={() => {
                      setError(null);
                      void decide({
                        organizationId,
                        approvalId: approvalDetail._id,
                        decision: "approved",
                        expectedPayloadHash: approvalDetail.actionPayloadHash,
                      }).catch((err: unknown) =>
                        setError(
                          err instanceof Error ? err.message : "Approve failed",
                        ),
                      );
                    }}
                  >
                    Approve exact payload
                  </button>
                ) : null}
                {approvalDetail.status === "approved" && canWrite ? (
                  <button
                    type="button"
                    className="rounded border border-amber-700 px-3 py-1.5 text-xs text-amber-900"
                    onClick={() => {
                      setError(null);
                      void (async () => {
                        try {
                          const exec = await executeApproved({
                            organizationId,
                            approvalId: approvalDetail._id,
                          });
                          setExecResult(
                            `Execute: ${exec.status} dryRun=${exec.dryRun} — ${exec.detail}`,
                          );
                        } catch (err) {
                          setError(
                            err instanceof Error
                              ? err.message
                              : "Execute failed",
                          );
                        }
                      })();
                    }}
                  >
                    Dry-run execute
                  </button>
                ) : null}
                {approvalDetail.status === "executed" ? (
                  <button
                    type="button"
                    className="rounded border border-slate-300 px-3 py-1.5 text-xs"
                    onClick={() => {
                      setError(null);
                      void (async () => {
                        try {
                          await executeApproved({
                            organizationId,
                            approvalId: approvalDetail._id,
                          });
                        } catch (err) {
                          setError(
                            err instanceof Error
                              ? err.message
                              : "Repeat execute failed",
                          );
                        }
                      })();
                    }}
                  >
                    Repeat execute (expect claim error)
                  </button>
                ) : null}
              </div>
              {execResult ? (
                <p className="text-sm text-slate-700">{execResult}</p>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : null}

      <section className="space-y-2">
        <h2 className="text-lg font-medium">Outbound ledger</h2>
        {(outbound ?? []).length === 0 ? (
          <p className="text-sm text-slate-500">No outbound actions yet.</p>
        ) : (
          <ul className="divide-y divide-slate-200 rounded border border-slate-200 bg-white">
            {(outbound ?? []).slice(0, 12).map((row) => (
              <li
                key={row._id}
                className="flex flex-wrap justify-between gap-2 px-4 py-3 text-sm"
              >
                <span>
                  <span className="font-medium">{row.status}</span>
                  {" · "}
                  {row.actionKey.slice(0, 48)}
                  {row.dryRun ? " · dry-run" : ""}
                </span>
                <span className="font-mono text-xs text-slate-500">
                  {row.destination}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
