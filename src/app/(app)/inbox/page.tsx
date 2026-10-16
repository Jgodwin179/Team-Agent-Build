"use client";

import { useState } from "react";
import Link from "next/link";
import { useMutation, useQuery } from "convex/react";
import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";
import { useActiveOrg } from "@/components/AppShell";

export default function InboxPage() {
  const { organizationId, org } = useActiveOrg();
  const items = useQuery(api.inbox.list, { organizationId });
  const reviews = useQuery(api.inbox.listAssociationReviews, {
    organizationId,
  });
  const deals = useQuery(api.deals.list, { organizationId });
  const resolve = useMutation(api.inbox.resolve);
  const resolveAssociation = useMutation(api.inbox.resolveAssociation);
  const [error, setError] = useState<string | null>(null);
  const [pickedDeal, setPickedDeal] = useState<
    Record<string, Id<"deals"> | "">
  >({});
  const canWrite = org.role !== "viewer";

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Inbox</h1>
        <p className="mt-1 text-sm text-slate-600">
          Association reviews, approval notifications, and DRY-RUN staff SMS
          alerts. Sensitive deal content stays in-app — SMS carries secure links
          only.
        </p>
      </div>

      {error ? (
        <p className="rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
          {error}
        </p>
      ) : null}

      <section className="space-y-3">
        <h2 className="text-lg font-medium">Association reviews</h2>
        {(reviews ?? []).length === 0 ? (
          <p className="text-sm text-slate-500">No pending reviews.</p>
        ) : (
          (reviews ?? []).map((review) => (
            <div
              key={review._id}
              className="rounded border border-slate-200 bg-white p-4"
            >
              <p className="text-sm font-medium">{review.reason}</p>
              <p className="mt-1 font-mono text-xs text-slate-500">
                review={review._id}
                {review.runId ? ` · run=${review.runId}` : ""}
              </p>
              {canWrite ? (
                <div className="mt-3 flex flex-wrap items-end gap-2">
                  <label className="flex min-w-[200px] flex-1 flex-col gap-1 text-sm">
                    <span className="text-slate-600">Assign deal</span>
                    <select
                      className="rounded border border-slate-300 px-3 py-2"
                      value={pickedDeal[review._id] ?? ""}
                      onChange={(e) =>
                        setPickedDeal((prev) => ({
                          ...prev,
                          [review._id]: e.target.value as Id<"deals"> | "",
                        }))
                      }
                    >
                      <option value="">Select deal…</option>
                      {(deals ?? []).map((d) => (
                        <option key={d._id} value={d._id}>
                          {d.title}
                        </option>
                      ))}
                    </select>
                  </label>
                  <button
                    type="button"
                    className="rounded bg-slate-900 px-3 py-2 text-sm text-white disabled:opacity-50"
                    disabled={!pickedDeal[review._id]}
                    onClick={() => {
                      const dealId = pickedDeal[review._id];
                      if (!dealId) return;
                      setError(null);
                      void resolveAssociation({
                        organizationId,
                        associationReviewId: review._id,
                        dealId,
                      }).catch((err: unknown) =>
                        setError(
                          err instanceof Error
                            ? err.message
                            : "Resolve failed",
                        ),
                      );
                    }}
                  >
                    Resolve association
                  </button>
                </div>
              ) : null}
            </div>
          ))
        )}
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-medium">Open items</h2>
        {(items ?? []).length === 0 ? (
          <p className="text-sm text-slate-500">Inbox is empty.</p>
        ) : (
          (items ?? []).map((item) => (
            <div
              key={item._id}
              className="flex flex-wrap items-start justify-between gap-3 rounded border border-slate-200 bg-white p-4"
            >
              <div>
                <p className="text-xs uppercase tracking-wide text-slate-500">
                  {item.kind} · {item.status}
                </p>
                <p className="mt-1 font-medium">{item.title}</p>
                <p className="mt-1 text-sm text-slate-600">{item.summary}</p>
                <div className="mt-2 flex flex-wrap gap-3 text-sm">
                  {item.secureLinkPath ? (
                    <Link
                      href={item.secureLinkPath}
                      className="text-slate-900 underline"
                    >
                      Open secure link
                    </Link>
                  ) : null}
                  {item.runId ? (
                    <Link
                      href={`/runs/${item.runId}`}
                      className="text-slate-700 underline"
                    >
                      View run
                    </Link>
                  ) : null}
                  {item.approvalId ? (
                    <Link
                      href={`/approvals?approvalId=${item.approvalId}`}
                      className="text-slate-700 underline"
                    >
                      Approval
                    </Link>
                  ) : null}
                </div>
              </div>
              {canWrite && item.status !== "resolved" ? (
                <button
                  type="button"
                  className="rounded border border-slate-300 px-3 py-1.5 text-sm"
                  onClick={() => {
                    setError(null);
                    void resolve({
                      organizationId,
                      inboxItemId: item._id,
                    }).catch((err: unknown) =>
                      setError(
                        err instanceof Error ? err.message : "Resolve failed",
                      ),
                    );
                  }}
                >
                  Mark resolved
                </button>
              ) : null}
            </div>
          ))
        )}
      </section>
    </div>
  );
}
