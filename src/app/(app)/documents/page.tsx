"use client";

import { useState } from "react";
import { useAction, useQuery } from "convex/react";
import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";
import { useActiveOrg } from "@/components/AppShell";

export default function DocumentsPage() {
  const { organizationId, org } = useActiveOrg();
  const deals = useQuery(api.deals.list, { organizationId });
  const boxConnections = useQuery(api.connections.list, {
    organizationId,
    provider: "box",
  });
  const [dealId, setDealId] = useState<Id<"deals"> | "">("");
  const [connectionId, setConnectionId] = useState<Id<"connections"> | "">("");
  const [folderId, setFolderId] = useState("0");
  const [selectedFileId, setSelectedFileId] = useState("");
  const [folderItems, setFolderItems] = useState<
    Array<{ id: string; name: string; type: string; size?: number }>
  >([]);
  const [listMeta, setListMeta] = useState<string | null>(null);
  const [ingestMeta, setIngestMeta] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [activeDocId, setActiveDocId] = useState<Id<"documents"> | null>(null);

  const documents = useQuery(api.documents.list, {
    organizationId,
    dealId: dealId || undefined,
  });
  const chunks = useQuery(
    api.documents.listChunks,
    activeDocId
      ? {
          organizationId,
          documentId: activeDocId,
          dealId: dealId || undefined,
        }
      : "skip",
  );

  const listBoxFolder = useAction(api.documents.listBoxFolder);
  const ingestFromBox = useAction(api.documents.ingestFromBox);
  const canWrite = org.role !== "viewer";

  async function browse() {
    setError(null);
    setListMeta(null);
    if (!connectionId) {
      setError("Select a Box connection first (create MOCK on Connections).");
      return;
    }
    try {
      const result = await listBoxFolder({
        organizationId,
        connectionId,
        folderId,
        limit: 25,
      });
      setFolderItems(result.items);
      setListMeta(
        [
          `mode=${result.mode}`,
          result.mockLabel,
          result.errorCode ? `error=${result.errorCode}` : null,
          result.nextOffset != null ? `nextOffset=${result.nextOffset}` : null,
        ]
          .filter(Boolean)
          .join(" · "),
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "List failed");
    }
  }

  async function ingest() {
    setError(null);
    setIngestMeta(null);
    if (!connectionId || !selectedFileId) {
      setError("Select connection and file id.");
      return;
    }
    try {
      const result = await ingestFromBox({
        organizationId,
        connectionId,
        dealId: dealId || undefined,
        fileId: selectedFileId,
      });
      setActiveDocId(result.documentId);
      setIngestMeta(
        [
          `pages=${result.pageCount}`,
          `extractor=${result.extractionProvider}`,
          `mode=${result.mode}`,
          result.mockLabel,
          result.warnings.join("; "),
        ]
          .filter(Boolean)
          .join(" · "),
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Ingest failed");
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Documents</h1>
        <p className="mt-1 text-sm text-slate-600">
          Ingest from Box (typed wrapper; MOCK when Composio unset) with
          page-level citations.
        </p>
      </div>

      <div className="grid gap-4 rounded border border-slate-200 bg-white p-4 md:grid-cols-2">
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-slate-600">Box connection</span>
          <select
            className="rounded border border-slate-300 px-3 py-2"
            value={connectionId}
            onChange={(e) =>
              setConnectionId(e.target.value as Id<"connections"> | "")
            }
          >
            <option value="">Select…</option>
            {(boxConnections ?? []).map((c) => (
              <option key={c._id} value={c._id}>
                {c.displayName} ({c.mode})
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-slate-600">Deal scope (optional)</span>
          <select
            className="rounded border border-slate-300 px-3 py-2"
            value={dealId}
            onChange={(e) => setDealId(e.target.value as Id<"deals"> | "")}
          >
            <option value="">Org-level / all</option>
            {(deals ?? []).map((d) => (
              <option key={d._id} value={d._id}>
                {d.title}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-slate-600">Folder id</span>
          <input
            className="rounded border border-slate-300 px-3 py-2 font-mono text-xs"
            value={folderId}
            onChange={(e) => setFolderId(e.target.value)}
          />
        </label>
        <div className="flex items-end gap-2">
          <button
            type="button"
            disabled={!canWrite}
            onClick={() => void browse()}
            className="rounded bg-slate-900 px-4 py-2 text-sm text-white disabled:bg-slate-400"
          >
            List folder
          </button>
          <button
            type="button"
            disabled={!canWrite}
            onClick={() => void ingest()}
            className="rounded border border-slate-900 px-4 py-2 text-sm disabled:opacity-50"
          >
            Ingest selected PDF
          </button>
        </div>
      </div>

      {listMeta ? (
        <p className="text-xs text-amber-900 bg-amber-50 border border-amber-200 rounded px-3 py-2">
          {listMeta}
        </p>
      ) : null}
      {ingestMeta ? (
        <p className="text-xs text-slate-700 bg-slate-100 rounded px-3 py-2">
          {ingestMeta}
        </p>
      ) : null}
      {error ? <p className="text-sm text-red-700">{error}</p> : null}

      {folderItems.length > 0 ? (
        <table className="w-full overflow-hidden rounded border border-slate-200 bg-white text-left text-sm">
          <thead className="bg-slate-50 text-slate-600">
            <tr>
              <th className="px-3 py-2 font-medium">Name</th>
              <th className="px-3 py-2 font-medium">Type</th>
              <th className="px-3 py-2 font-medium">Id</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {folderItems.map((item) => (
              <tr
                key={item.id}
                className={
                  selectedFileId === item.id ? "bg-slate-100" : undefined
                }
              >
                <td className="px-3 py-2">
                  <button
                    type="button"
                    className="text-left hover:underline"
                    onClick={() => setSelectedFileId(item.id)}
                  >
                    {item.name}
                  </button>
                </td>
                <td className="px-3 py-2 text-xs uppercase">{item.type}</td>
                <td className="px-3 py-2 font-mono text-xs text-slate-500">
                  {item.id}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}

      <div>
        <h2 className="text-lg font-medium">Ingested documents</h2>
        {!documents ? (
          <p className="text-sm text-slate-500">Loading…</p>
        ) : documents.length === 0 ? (
          <p className="mt-2 text-sm text-slate-500">None yet.</p>
        ) : (
          <ul className="mt-2 divide-y divide-slate-100 rounded border border-slate-200 bg-white">
            {documents.map((doc) => (
              <li key={doc._id}>
                <button
                  type="button"
                  className="flex w-full items-center justify-between px-3 py-2 text-left text-sm hover:bg-slate-50"
                  onClick={() => setActiveDocId(doc._id)}
                >
                  <span>{doc.title}</span>
                  <span className="text-xs text-slate-500">
                    {doc.processingStatus}
                    {doc.extractionProvider
                      ? ` · ${doc.extractionProvider}`
                      : ""}
                    {doc.pageCount != null ? ` · ${doc.pageCount}p` : ""}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {chunks && chunks.length > 0 ? (
        <div className="space-y-2">
          <h2 className="text-lg font-medium">Citations</h2>
          {chunks.map((chunk) => (
            <blockquote
              key={chunk._id}
              className="rounded border-l-4 border-slate-400 bg-white px-4 py-3 text-sm"
            >
              <p className="text-xs font-medium text-slate-500">
                {chunk.citation}
                {chunk.sectionLabel ? ` · ${chunk.sectionLabel}` : ""}
              </p>
              <p className="mt-1 whitespace-pre-wrap text-slate-800">
                {chunk.text}
              </p>
            </blockquote>
          ))}
        </div>
      ) : null}
    </div>
  );
}
