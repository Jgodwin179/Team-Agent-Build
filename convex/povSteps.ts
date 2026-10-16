import { v } from "convex/values";
import { internalMutation, internalQuery } from "./_generated/server";
import { payloadHash } from "./lib/hash";
import { mockSellerPdfBase64 } from "./lib/mockPdfBase64";

export const loadInboundPayload = internalQuery({
  args: { runId: v.id("runs") },
  returns: v.union(
    v.object({
      from: v.string(),
      subject: v.string(),
      text: v.string(),
      attachmentName: v.string(),
      attachmentContentBase64: v.string(),
      notifyPhone: v.string(),
      dealId: v.optional(v.id("deals")),
      organizationId: v.id("organizations"),
      associationPending: v.boolean(),
    }),
    v.null(),
  ),
  handler: async (ctx, args) => {
    const run = await ctx.db.get("runs", args.runId);
    if (!run?.inboundEventId) return null;
    const event = await ctx.db.get("inboundEvents", run.inboundEventId);
    if (!event) return null;
    const payload = JSON.parse(event.payloadJson) as {
      from: string;
      subject: string;
      text: string;
      attachmentName?: string;
      attachmentContentBase64?: string;
      notifyPhone?: string;
    };
    const pendingReview = await ctx.db
      .query("associationReviews")
      .withIndex("by_inbound_event", (q) =>
        q.eq("inboundEventId", event._id),
      )
      .unique();
    return {
      from: payload.from,
      subject: payload.subject,
      text: payload.text,
      attachmentName: payload.attachmentName ?? "seller-cim.pdf",
      attachmentContentBase64:
        payload.attachmentContentBase64 ?? mockSellerPdfBase64(),
      notifyPhone: payload.notifyPhone ?? "+15555550199",
      dealId: run.dealId,
      organizationId: run.organizationId,
      associationPending: pendingReview?.status === "pending_review",
    };
  },
});

export const persistDocumentFromEmail = internalMutation({
  args: {
    organizationId: v.id("organizations"),
    runId: v.id("runs"),
    dealId: v.optional(v.id("deals")),
    title: v.string(),
    contentBase64: v.string(),
    pages: v.array(
      v.object({
        pageNumber: v.number(),
        text: v.string(),
        sectionLabel: v.optional(v.string()),
      }),
    ),
    extractionProvider: v.string(),
    actorAuthUserId: v.string(),
  },
  returns: v.id("documents"),
  handler: async (ctx, args) => {
    const now = Date.now();
    // Store a tiny placeholder in _storage via text blob of hash only —
    // full binary already extracted; keep contentHash for dedupe.
    const hash = payloadHash(args.contentBase64.slice(0, 2048));
    const documentId = await ctx.db.insert("documents", {
      organizationId: args.organizationId,
      dealId: args.dealId,
      title: args.title,
      sourceProvider: "agentmail",
      sourceExternalId: `email-run-${args.runId}`,
      contentHash: hash,
      contentType: "application/pdf",
      byteSize: Math.floor((args.contentBase64.length * 3) / 4),
      processingStatus: "ready",
      extractionProvider: args.extractionProvider,
      pageCount: args.pages.length,
      createdAt: now,
      updatedAt: now,
    });
    for (const page of args.pages) {
      await ctx.db.insert("documentChunks", {
        organizationId: args.organizationId,
        documentId,
        dealId: args.dealId,
        pageNumber: page.pageNumber,
        sectionLabel: page.sectionLabel,
        text: page.text,
        createdAt: now,
      });
    }
    return documentId;
  },
});

export const proposeGhlNoteFromDoc = internalMutation({
  args: {
    organizationId: v.id("organizations"),
    runId: v.id("runs"),
    dealId: v.optional(v.id("deals")),
    documentId: v.id("documents"),
    principalAuthUserId: v.string(),
    citationSummary: v.string(),
  },
  returns: v.id("approvals"),
  handler: async (ctx, args) => {
    const organization = await ctx.db.get("organizations", args.organizationId);
    if (!organization) throw new Error("Organization not found");

    const proposal = {
      actionType: "ghl.add_note" as const,
      contactId: "mock-contact-1",
      body: `Document specialist summary (dry-run):\n${args.citationSummary}`,
    };
    const actionPayloadJson = JSON.stringify(proposal);
    const actionPayloadHash = payloadHash(actionPayloadJson);
    const now = Date.now();

    const approvalId = await ctx.db.insert("approvals", {
      organizationId: args.organizationId,
      runId: args.runId,
      dealId: args.dealId,
      actionType: proposal.actionType,
      actionPayloadJson,
      actionPayloadHash,
      proposedByAuthUserId: args.principalAuthUserId,
      status: "pending",
      expiresAt: now + 24 * 60 * 60 * 1000,
      createdAt: now,
      updatedAt: now,
    });

    await ctx.db.insert("outboundActions", {
      organizationId: args.organizationId,
      approvalId,
      runId: args.runId,
      actionKey: `${proposal.actionType}:${actionPayloadHash}`,
      destination: `ghl:contact:${proposal.contactId}`,
      payloadHash: actionPayloadHash,
      status: "proposed",
      dryRun: organization.outboundDryRun !== false,
      createdAt: now,
      updatedAt: now,
    });

    await ctx.db.insert("inboxItems", {
      organizationId: args.organizationId,
      kind: "approval",
      status: "unread",
      title: "Approve GHL note (POV)",
      summary: proposal.body.slice(0, 200),
      dealId: args.dealId,
      runId: args.runId,
      approvalId,
      assigneeAuthUserId: args.principalAuthUserId,
      secureLinkPath: `/approvals?approvalId=${approvalId}`,
      createdAt: now,
      updatedAt: now,
    });

    await ctx.db.patch("runs", args.runId, {
      status: "waiting_for_approval",
      updatedAt: now,
    });

    return approvalId;
  },
});

export const recordSmsDryRun = internalMutation({
  args: {
    organizationId: v.id("organizations"),
    runId: v.id("runs"),
    approvalId: v.id("approvals"),
    to: v.string(),
    secureLinkPath: v.string(),
    actorAuthUserId: v.string(),
  },
  returns: v.object({
    status: v.literal("dry_run"),
    externalId: v.string(),
  }),
  handler: async (ctx, args) => {
    const now = Date.now();
    const externalId = `dry-run-sms-${args.approvalId}`;
    await ctx.db.insert("auditEvents", {
      organizationId: args.organizationId,
      actorAuthUserId: args.actorAuthUserId,
      action: "sms.notify_dry_run",
      targetType: "approvals",
      targetId: args.approvalId,
      metadata: JSON.stringify({
        to: args.to,
        secureLinkPath: args.secureLinkPath,
        body: `Team Agent: approval ready. Open ${args.secureLinkPath} (no deal details in SMS).`,
        mode: "dry-run",
      }),
      createdAt: now,
    });
    await ctx.db.insert("inboxItems", {
      organizationId: args.organizationId,
      kind: "assignment",
      status: "unread",
      title: "SMS staff alert (DRY-RUN)",
      summary: `Would SMS ${args.to} with secure link ${args.secureLinkPath}`,
      runId: args.runId,
      approvalId: args.approvalId,
      secureLinkPath: args.secureLinkPath,
      createdAt: now,
      updatedAt: now,
    });
    return { status: "dry_run" as const, externalId };
  },
});

export const completePovRun = internalMutation({
  args: {
    runId: v.id("runs"),
    summary: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const run = await ctx.db.get("runs", args.runId);
    if (!run) throw new Error("Run not found");
    // Leave waiting_for_approval until user approves; only mark succeeded after execute.
    if (run.status === "waiting_for_approval") {
      await ctx.db.patch("runs", args.runId, {
        resultSummary: args.summary,
        updatedAt: Date.now(),
      });
      return null;
    }
    await ctx.db.patch("runs", args.runId, {
      status: "succeeded",
      resultSummary: args.summary,
      completedAt: Date.now(),
      updatedAt: Date.now(),
    });
    return null;
  },
});
