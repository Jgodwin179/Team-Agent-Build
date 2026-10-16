import { v } from "convex/values";
import { paginationOptsValidator } from "convex/server";
import {
  action,
  internalMutation,
  mutation,
  query,
} from "./_generated/server";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { requireOrgAccess } from "./lib/permissions";
import { requireDocumentInOrg } from "./lib/documentAccess";
import { documentProcessingStatusValidator } from "./schema";
import { payloadHash } from "./lib/hash";

function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) {
    out[i] = bin.charCodeAt(i);
  }
  return out;
}

const documentReturn = v.object({
  _id: v.id("documents"),
  _creationTime: v.number(),
  organizationId: v.id("organizations"),
  dealId: v.optional(v.id("deals")),
  title: v.string(),
  sourceProvider: v.string(),
  sourceExternalId: v.optional(v.string()),
  sourceVersion: v.optional(v.string()),
  storageId: v.optional(v.id("_storage")),
  contentHash: v.optional(v.string()),
  contentType: v.string(),
  byteSize: v.optional(v.number()),
  processingStatus: documentProcessingStatusValidator,
  extractionProvider: v.optional(v.string()),
  pageCount: v.optional(v.number()),
  errorMessage: v.optional(v.string()),
  connectionId: v.optional(v.id("connections")),
  createdAt: v.number(),
  updatedAt: v.number(),
});

const chunkReturn = v.object({
  _id: v.id("documentChunks"),
  documentId: v.id("documents"),
  dealId: v.optional(v.id("deals")),
  pageNumber: v.number(),
  sectionLabel: v.optional(v.string()),
  text: v.string(),
  citation: v.string(),
});

export const list = query({
  args: {
    organizationId: v.id("organizations"),
    dealId: v.optional(v.id("deals")),
  },
  returns: v.array(documentReturn),
  handler: async (ctx, args) => {
    await requireOrgAccess(ctx, args.organizationId, "viewer");
    const rows = await ctx.db
      .query("documents")
      .withIndex("by_org_and_deal", (q) =>
        q.eq("organizationId", args.organizationId).eq("dealId", args.dealId),
      )
      .collect();
    // When dealId omitted, also include org-level docs with undefined deal via status index
    if (args.dealId === undefined) {
      const all = await ctx.db
        .query("documents")
        .withIndex("by_org_and_status", (q) =>
          q.eq("organizationId", args.organizationId),
        )
        .collect();
      return all.sort((a, b) => b.updatedAt - a.updatedAt);
    }
    return rows.sort((a, b) => b.updatedAt - a.updatedAt);
  },
});

export const get = query({
  args: {
    organizationId: v.id("organizations"),
    documentId: v.id("documents"),
    dealId: v.optional(v.id("deals")),
  },
  returns: v.union(documentReturn, v.null()),
  handler: async (ctx, args) => {
    await requireOrgAccess(ctx, args.organizationId, "viewer");
    try {
      return await requireDocumentInOrg(
        ctx,
        args.organizationId,
        args.documentId,
        { dealId: args.dealId },
      );
    } catch {
      return null;
    }
  },
});

export const listChunks = query({
  args: {
    organizationId: v.id("organizations"),
    documentId: v.id("documents"),
    dealId: v.optional(v.id("deals")),
  },
  returns: v.array(chunkReturn),
  handler: async (ctx, args) => {
    await requireOrgAccess(ctx, args.organizationId, "viewer");
    await requireDocumentInOrg(ctx, args.organizationId, args.documentId, {
      dealId: args.dealId,
    });
    const chunks = await ctx.db
      .query("documentChunks")
      .withIndex("by_document_and_page", (q) =>
        q.eq("documentId", args.documentId),
      )
      .collect();
    return chunks
      .sort((a, b) => a.pageNumber - b.pageNumber)
      .map((c) => ({
        _id: c._id,
        documentId: c.documentId,
        dealId: c.dealId,
        pageNumber: c.pageNumber,
        sectionLabel: c.sectionLabel,
        text: c.text,
        citation: `p.${c.pageNumber}`,
      }));
  },
});

/**
 * Cross-deal denial helper used by UI/tests: returns null rather than leaking.
 */
export const getChunksForDeal = query({
  args: {
    organizationId: v.id("organizations"),
    dealId: v.id("deals"),
    documentId: v.id("documents"),
  },
  returns: v.union(v.array(chunkReturn), v.null()),
  handler: async (ctx, args) => {
    await requireOrgAccess(ctx, args.organizationId, "viewer");
    const doc = await ctx.db.get("documents", args.documentId);
    if (
      !doc ||
      doc.organizationId !== args.organizationId ||
      doc.dealId !== args.dealId
    ) {
      return null;
    }
    const chunks = await ctx.db
      .query("documentChunks")
      .withIndex("by_document_and_page", (q) =>
        q.eq("documentId", args.documentId),
      )
      .collect();
    return chunks.map((c) => ({
      _id: c._id,
      documentId: c.documentId,
      dealId: c.dealId,
      pageNumber: c.pageNumber,
      sectionLabel: c.sectionLabel,
      text: c.text,
      citation: `p.${c.pageNumber}`,
    }));
  },
});

export const listBoxFolder = action({
  args: {
    organizationId: v.id("organizations"),
    connectionId: v.id("connections"),
    folderId: v.string(),
    limit: v.optional(v.number()),
    offset: v.optional(v.number()),
    simulate: v.optional(
      v.union(v.literal("expired_auth"), v.literal("denied_scope")),
    ),
  },
  returns: v.object({
    items: v.array(
      v.object({
        id: v.string(),
        name: v.string(),
        type: v.string(),
        size: v.optional(v.number()),
        modifiedAt: v.optional(v.string()),
      }),
    ),
    nextOffset: v.optional(v.number()),
    mode: v.union(v.literal("mock"), v.literal("live")),
    mockLabel: v.optional(v.string()),
    errorCode: v.optional(v.string()),
  }),
  handler: async (ctx, args): Promise<{
    items: Array<{
      id: string;
      name: string;
      type: string;
      size?: number;
      modifiedAt?: string;
    }>;
    nextOffset?: number;
    mode: "mock" | "live";
    mockLabel?: string;
    errorCode?: string;
  }> => {
    const org = await ctx.runQuery(api.organizations.get, {
      organizationId: args.organizationId,
    });
    if (!org) {
      throw new Error("Unauthorized: organization access denied");
    }
    const active = await ctx.runQuery(internal.connections.getInternal, {
      organizationId: args.organizationId,
      connectionId: args.connectionId,
    });
    if (!active || active.provider !== "box") {
      throw new Error("Box connection not found or inactive");
    }

    return await ctx.runAction(internal.boxActions.listFolder, {
      mode: active.mode,
      folderId: args.folderId,
      limit: args.limit,
      offset: args.offset,
      composioUserId: active.composioUserId,
      connectedAccountId: active.managedCredentialRef,
      simulate: args.simulate,
    });
  },
});

export const ingestFromBox = action({
  args: {
    organizationId: v.id("organizations"),
    connectionId: v.id("connections"),
    dealId: v.optional(v.id("deals")),
    fileId: v.string(),
  },
  returns: v.object({
    documentId: v.id("documents"),
    mode: v.union(v.literal("mock"), v.literal("live")),
    mockLabel: v.optional(v.string()),
    extractionProvider: v.string(),
    pageCount: v.number(),
    warnings: v.array(v.string()),
  }),
  handler: async (ctx, args): Promise<{
    documentId: Id<"documents">;
    mode: "mock" | "live";
    mockLabel?: string;
    extractionProvider: string;
    pageCount: number;
    warnings: string[];
  }> => {
    const org = await ctx.runQuery(api.organizations.get, {
      organizationId: args.organizationId,
    });
    if (!org) {
      throw new Error("Unauthorized: organization access denied");
    }
    const active = await ctx.runQuery(internal.connections.getInternal, {
      organizationId: args.organizationId,
      connectionId: args.connectionId,
    });
    if (!active || active.provider !== "box") {
      throw new Error("Box connection not found or inactive");
    }

    const download = await ctx.runAction(internal.boxActions.downloadFile, {
      mode: active.mode,
      fileId: args.fileId,
      composioUserId: active.composioUserId,
      connectedAccountId: active.managedCredentialRef,
    });
    if (!download.ok || !download.contentBase64) {
      throw new Error(
        download.errorMessage ??
          `Box download failed (${download.errorCode ?? "unknown"})`,
      );
    }

    const extraction = await ctx.runAction(internal.documentActions.extractPdf, {
      contentBase64: download.contentBase64,
    });

    const bytes = base64ToBytes(download.contentBase64);
    const arrayBuffer = new ArrayBuffer(bytes.byteLength);
    new Uint8Array(arrayBuffer).set(bytes);
    const blob = new Blob([arrayBuffer], {
      type: download.contentType ?? "application/pdf",
    });
    const storageId = await ctx.storage.store(blob);

    const documentId = await ctx.runMutation(internal.documents.persistIngest, {
      organizationId: args.organizationId,
      dealId: args.dealId,
      connectionId: args.connectionId,
      title: download.name ?? args.fileId,
      sourceProvider: "box",
      sourceExternalId: args.fileId,
      storageId,
      contentType: download.contentType ?? "application/pdf",
      byteSize: bytes.byteLength,
      contentHash: payloadHash(download.contentBase64.slice(0, 2048)),
      extractionProvider: extraction.provider,
      pageCount: extraction.pageCount,
      pages: extraction.pages,
      actorAuthUserId: active.ownerAuthUserId,
    });

    return {
      documentId,
      mode: download.mode,
      mockLabel: download.mockLabel ?? extraction.mockLabel,
      extractionProvider: extraction.provider,
      pageCount: extraction.pageCount,
      warnings: extraction.warnings,
    };
  },
});

export const persistIngest = internalMutation({
  args: {
    organizationId: v.id("organizations"),
    dealId: v.optional(v.id("deals")),
    connectionId: v.optional(v.id("connections")),
    title: v.string(),
    sourceProvider: v.string(),
    sourceExternalId: v.string(),
    storageId: v.id("_storage"),
    contentType: v.string(),
    byteSize: v.number(),
    contentHash: v.string(),
    extractionProvider: v.string(),
    pageCount: v.number(),
    pages: v.array(
      v.object({
        pageNumber: v.number(),
        text: v.string(),
        sectionLabel: v.optional(v.string()),
      }),
    ),
    actorAuthUserId: v.string(),
  },
  returns: v.id("documents"),
  handler: async (ctx, args) => {
    const now = Date.now();
    const existing = await ctx.db
      .query("documents")
      .withIndex("by_org_source_external", (q) =>
        q
          .eq("organizationId", args.organizationId)
          .eq("sourceProvider", args.sourceProvider)
          .eq("sourceExternalId", args.sourceExternalId),
      )
      .unique();

    let documentId = existing?._id;
    if (existing) {
      await ctx.db.patch("documents", existing._id, {
        dealId: args.dealId,
        title: args.title,
        storageId: args.storageId,
        contentHash: args.contentHash,
        contentType: args.contentType,
        byteSize: args.byteSize,
        processingStatus: "ready",
        extractionProvider: args.extractionProvider,
        pageCount: args.pageCount,
        errorMessage: undefined,
        connectionId: args.connectionId,
        updatedAt: now,
      });
      const oldChunks = await ctx.db
        .query("documentChunks")
        .withIndex("by_document_and_page", (q) =>
          q.eq("documentId", existing._id),
        )
        .collect();
      for (const chunk of oldChunks) {
        await ctx.db.delete("documentChunks", chunk._id);
      }
    } else {
      documentId = await ctx.db.insert("documents", {
        organizationId: args.organizationId,
        dealId: args.dealId,
        title: args.title,
        sourceProvider: args.sourceProvider,
        sourceExternalId: args.sourceExternalId,
        storageId: args.storageId,
        contentHash: args.contentHash,
        contentType: args.contentType,
        byteSize: args.byteSize,
        processingStatus: "ready",
        extractionProvider: args.extractionProvider,
        pageCount: args.pageCount,
        connectionId: args.connectionId,
        createdAt: now,
        updatedAt: now,
      });
    }

    for (const page of args.pages) {
      await ctx.db.insert("documentChunks", {
        organizationId: args.organizationId,
        documentId: documentId!,
        dealId: args.dealId,
        pageNumber: page.pageNumber,
        sectionLabel: page.sectionLabel,
        text: page.text,
        createdAt: now,
      });
    }

    await ctx.db.insert("auditEvents", {
      organizationId: args.organizationId,
      actorAuthUserId: args.actorAuthUserId,
      action: "document.ingest",
      targetType: "documents",
      targetId: documentId!,
      metadata: JSON.stringify({
        sourceProvider: args.sourceProvider,
        pageCount: args.pageCount,
        extractionProvider: args.extractionProvider,
      }),
      createdAt: now,
    });

    return documentId!;
  },
});

/** Paginated document list for large orgs (fixture for pagination gate). */
export const listPaginated = query({
  args: {
    organizationId: v.id("organizations"),
    paginationOpts: paginationOptsValidator,
  },
  returns: v.any(),
  handler: async (ctx, args) => {
    await requireOrgAccess(ctx, args.organizationId, "viewer");
    return await ctx.db
      .query("documents")
      .withIndex("by_org_and_status", (q) =>
        q.eq("organizationId", args.organizationId),
      )
      .order("desc")
      .paginate(args.paginationOpts);
  },
});

export const generateUploadUrl = mutation({
  args: { organizationId: v.id("organizations") },
  returns: v.string(),
  handler: async (ctx, args) => {
    await requireOrgAccess(ctx, args.organizationId, "member");
    return await ctx.storage.generateUploadUrl();
  },
});
