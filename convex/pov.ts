import { v } from "convex/values";
import type { WorkflowId } from "@convex-dev/workflow";
import type { Id } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";
import { env, mutation, query } from "./_generated/server";
import { internal } from "./_generated/api";
import { requireOrgAccess } from "./lib/permissions";
import { resolveDealAssociation } from "./lib/association";
import { mockSellerPdfBase64 } from "./lib/mockPdfBase64";
import { workflowManager } from "./workflows/manager";

type StartArgs = {
  organizationId: Id<"organizations">;
  principalAuthUserId: string;
  providerEventId: string;
  from: string;
  subject: string;
  text: string;
  attachmentName?: string;
  attachmentContentBase64?: string;
  dealHint?: string;
  forceAmbiguous?: boolean;
  notifyPhone?: string;
};

async function startFlowAsPrincipal(
  ctx: MutationCtx,
  args: StartArgs,
): Promise<{
  runId: Id<"runs">;
  inboundEventId: Id<"inboundEvents">;
  workflowId: string;
  association: string;
  deduplicated: boolean;
}> {
  const organization = await ctx.db.get("organizations", args.organizationId);
  if (!organization) throw new Error("Organization not found");

  const dedupeKey = `agentmail:message:${args.providerEventId}`;
  const existing = await ctx.db
    .query("inboundEvents")
    .withIndex("by_dedupe", (q) =>
      q.eq("organizationId", args.organizationId).eq("dedupeKey", dedupeKey),
    )
    .unique();
  if (existing?.runId) {
    return {
      runId: existing.runId,
      inboundEventId: existing._id,
      workflowId: (await ctx.db.get("runs", existing.runId))?.workflowId ?? "",
      association: "deduplicated",
      deduplicated: true as const,
    };
  }

  const deals = await ctx.db
    .query("deals")
    .withIndex("by_org_and_status", (q) =>
      q.eq("organizationId", args.organizationId),
    )
    .collect();

  let association = args.forceAmbiguous
    ? {
        kind: "ambiguous" as const,
        candidateDealIds: deals.slice(0, 2).map((d) => d._id),
        reason: "MOCK fixture — forced ambiguous association",
      }
    : resolveDealAssociation({
        deals,
        subject: args.subject,
        from: args.from,
        dealHint: args.dealHint,
        text: args.text,
      });

  if (
    association.kind === "ambiguous" &&
    association.candidateDealIds.length === 0
  ) {
    association = {
      kind: "unmatched",
      reason: association.reason,
    };
  }

  const now = Date.now();
  const pdfBytes = args.attachmentContentBase64 ?? mockSellerPdfBase64();

  const inboundEventId = await ctx.db.insert("inboundEvents", {
    organizationId: args.organizationId,
    provider: "agentmail",
    providerAccount: "agent-inbox",
    providerEventId: args.providerEventId,
    dedupeKey,
    eventType: "email.message_received",
    occurredAt: now,
    receivedAt: now,
    payloadJson: JSON.stringify({
      from: args.from,
      subject: args.subject,
      text: args.text,
      attachmentName: args.attachmentName ?? "seller-cim.pdf",
      attachmentContentBase64: pdfBytes,
      dealHint: args.dealHint,
      notifyPhone: args.notifyPhone ?? "+15555550199",
      association,
    }),
    status: "received",
    attempts: 0,
  });

  const dealId =
    association.kind === "matched" ? association.dealId : undefined;

  const runId = await ctx.db.insert("runs", {
    organizationId: args.organizationId,
    dealId,
    inboundEventId,
    principalAuthUserId: args.principalAuthUserId,
    title: `POV: ${args.subject.slice(0, 80)}`,
    assignmentPrompt: args.text,
    status: "queued",
    budgetTokens: organization.settings.defaultBudgetTokens ?? 50_000,
    usedTokens: 0,
    maxSteps: organization.settings.maxAgentSteps ?? 12,
    modelMode: "mock",
    completedSteps: [],
    createdAt: now,
    updatedAt: now,
  });

  await ctx.db.patch("inboundEvents", inboundEventId, {
    runId,
    status: "claimed",
  });

  if (association.kind !== "matched") {
    const reviewId = await ctx.db.insert("associationReviews", {
      organizationId: args.organizationId,
      inboundEventId,
      runId,
      candidateDealIds:
        association.kind === "ambiguous" ? association.candidateDealIds : [],
      reason: association.reason,
      status: "pending_review",
      createdAt: now,
      updatedAt: now,
    });
    await ctx.db.insert("inboxItems", {
      organizationId: args.organizationId,
      kind: "association_review",
      status: "unread",
      title: "Review deal association",
      summary: association.reason,
      runId,
      associationReviewId: reviewId,
      inboundEventId,
      createdAt: now,
      updatedAt: now,
    });
  }

  const workflowId: WorkflowId = await workflowManager.start(
    ctx,
    internal.workflows.povWorkflow.povWorkflow,
    {
      runId,
      organizationId: args.organizationId,
      principalAuthUserId: args.principalAuthUserId,
      waitForAssociation: association.kind !== "matched",
    },
  );

  await ctx.db.patch("runs", runId, {
    workflowId: String(workflowId),
    updatedAt: Date.now(),
  });

  await ctx.db.insert("auditEvents", {
    organizationId: args.organizationId,
    actorAuthUserId: args.principalAuthUserId,
    action: "pov.started",
    targetType: "runs",
    targetId: runId,
    metadata: JSON.stringify({
      association: association.kind,
      dryRun: organization.outboundDryRun !== false,
    }),
    createdAt: Date.now(),
  });

  return {
    runId,
    inboundEventId,
    workflowId: String(workflowId),
    association: association.kind,
    deduplicated: false as const,
  };
}

/**
 * Start the seller-PDF proof-of-value flow (dry-run).
 * Simulates AgentMail inbound with a PDF attachment when content not provided.
 */
export const startSellerPdfFlow = mutation({
  args: {
    organizationId: v.id("organizations"),
    from: v.optional(v.string()),
    subject: v.optional(v.string()),
    text: v.optional(v.string()),
    dealHint: v.optional(v.string()),
    forceAmbiguous: v.optional(v.boolean()),
    providerEventId: v.optional(v.string()),
    attachmentContentBase64: v.optional(v.string()),
    attachmentName: v.optional(v.string()),
    notifyPhone: v.optional(v.string()),
  },
  returns: v.object({
    runId: v.id("runs"),
    inboundEventId: v.id("inboundEvents"),
    workflowId: v.string(),
    association: v.string(),
    deduplicated: v.boolean(),
  }),
  handler: async (
    ctx,
    args,
  ): Promise<{
    runId: Id<"runs">;
    inboundEventId: Id<"inboundEvents">;
    workflowId: string;
    association: string;
    deduplicated: boolean;
  }> => {
    const { user } = await requireOrgAccess(ctx, args.organizationId, "member");
    const deals = await ctx.db
      .query("deals")
      .withIndex("by_org_and_status", (q) =>
        q.eq("organizationId", args.organizationId),
      )
      .take(1);
    const subject =
      args.subject ??
      (deals[0] ? `${deals[0].title} — CIM attached` : "Seller CIM PDF");

    return await startFlowAsPrincipal(ctx, {
      organizationId: args.organizationId,
      principalAuthUserId: user.id,
      providerEventId:
        args.providerEventId ??
        `agentmail-pov-${user.id}-${subject.slice(0, 40)}-${Date.now()}`,
      from: args.from ?? "seller@example.test",
      subject,
      text:
        args.text ??
        "Please find the CIM PDF attached for your review.",
      attachmentName: args.attachmentName,
      attachmentContentBase64: args.attachmentContentBase64,
      dealHint: args.dealHint ?? deals[0]?._id,
      forceAmbiguous: args.forceAmbiguous,
      notifyPhone: args.notifyPhone,
    });
  },
});

/** Webhook-compatible ingest (secret-gated when AGENTMAIL_WEBHOOK_SECRET set). */
export const ingestSellerEmail = mutation({
  args: {
    organizationId: v.id("organizations"),
    providerEventId: v.string(),
    from: v.string(),
    subject: v.string(),
    text: v.string(),
    attachmentName: v.optional(v.string()),
    attachmentContentBase64: v.optional(v.string()),
    dealHint: v.optional(v.string()),
    viaWebhook: v.optional(v.boolean()),
    webhookSecret: v.optional(v.string()),
  },
  returns: v.object({
    runId: v.id("runs"),
    inboundEventId: v.id("inboundEvents"),
    workflowId: v.string(),
    association: v.string(),
    deduplicated: v.boolean(),
  }),
  handler: async (
    ctx,
    args,
  ): Promise<{
    runId: Id<"runs">;
    inboundEventId: Id<"inboundEvents">;
    workflowId: string;
    association: string;
    deduplicated: boolean;
  }> => {
    if (args.viaWebhook) {
      const expected = env.AGENTMAIL_WEBHOOK_SECRET;
      if (expected && args.webhookSecret !== expected) {
        throw new Error("Unauthorized webhook");
      }
      const memberships = await ctx.db
        .query("memberships")
        .withIndex("by_org_and_status", (q) =>
          q.eq("organizationId", args.organizationId).eq("status", "active"),
        )
        .collect();
      const owner =
        memberships.find((m) => m.role === "owner") ?? memberships[0];
      if (!owner) throw new Error("No active membership for organization");

      return await startFlowAsPrincipal(ctx, {
        organizationId: args.organizationId,
        principalAuthUserId: owner.authUserId,
        providerEventId: args.providerEventId,
        from: args.from,
        subject: args.subject,
        text: args.text,
        attachmentName: args.attachmentName,
        attachmentContentBase64: args.attachmentContentBase64,
        dealHint: args.dealHint,
      });
    }

    const { user } = await requireOrgAccess(
      ctx,
      args.organizationId,
      "member",
    );
    return await startFlowAsPrincipal(ctx, {
      organizationId: args.organizationId,
      principalAuthUserId: user.id,
      providerEventId: args.providerEventId,
      from: args.from,
      subject: args.subject,
      text: args.text,
      attachmentName: args.attachmentName,
      attachmentContentBase64: args.attachmentContentBase64,
      dealHint: args.dealHint,
    });
  },
});

export const getFlowStatus = query({
  args: {
    organizationId: v.id("organizations"),
    runId: v.id("runs"),
  },
  returns: v.union(
    v.object({
      runStatus: v.string(),
      dealId: v.optional(v.id("deals")),
      resultSummary: v.optional(v.string()),
      approvalId: v.optional(v.id("approvals")),
      inboxCount: v.number(),
    }),
    v.null(),
  ),
  handler: async (ctx, args) => {
    await requireOrgAccess(ctx, args.organizationId, "viewer");
    const run = await ctx.db.get("runs", args.runId);
    if (!run || run.organizationId !== args.organizationId) return null;
    const approvals = await ctx.db
      .query("approvals")
      .withIndex("by_run", (q) => q.eq("runId", args.runId))
      .collect();
    const inbox = await ctx.db
      .query("inboxItems")
      .withIndex("by_run", (q) => q.eq("runId", args.runId))
      .collect();
    return {
      runStatus: run.status,
      dealId: run.dealId,
      resultSummary: run.resultSummary,
      approvalId: approvals[0]?._id,
      inboxCount: inbox.length,
    };
  },
});
