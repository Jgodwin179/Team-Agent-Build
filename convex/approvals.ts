import { v } from "convex/values";
import {
  action,
  internalMutation,
  mutation,
  query,
} from "./_generated/server";
import { api, internal } from "./_generated/api";
import { requireOrgAccess } from "./lib/permissions";
import { payloadHash } from "./lib/hash";
import { approvalStatusValidator } from "./schema";

const approvalDetail = v.object({
  _id: v.id("approvals"),
  _creationTime: v.number(),
  organizationId: v.id("organizations"),
  runId: v.optional(v.id("runs")),
  dealId: v.optional(v.id("deals")),
  actionType: v.string(),
  actionPayloadJson: v.string(),
  actionPayloadHash: v.string(),
  proposedByAuthUserId: v.string(),
  status: approvalStatusValidator,
  expiresAt: v.number(),
  decidedByAuthUserId: v.optional(v.string()),
  decidedAt: v.optional(v.number()),
  decisionNote: v.optional(v.string()),
  outboundActionId: v.optional(v.id("outboundActions")),
  consumedAt: v.optional(v.number()),
  createdAt: v.number(),
  updatedAt: v.number(),
});

export const get = query({
  args: {
    organizationId: v.id("organizations"),
    approvalId: v.id("approvals"),
  },
  returns: v.union(approvalDetail, v.null()),
  handler: async (ctx, args) => {
    await requireOrgAccess(ctx, args.organizationId, "viewer");
    const approval = await ctx.db.get("approvals", args.approvalId);
    if (!approval || approval.organizationId !== args.organizationId) {
      return null;
    }
    return approval;
  },
});

export const decide = mutation({
  args: {
    organizationId: v.id("organizations"),
    approvalId: v.id("approvals"),
    decision: v.union(v.literal("approved"), v.literal("rejected")),
    decisionNote: v.optional(v.string()),
    /** Client must echo the hash so edits invalidate approval. */
    expectedPayloadHash: v.string(),
  },
  returns: v.object({
    status: approvalStatusValidator,
    outboundActionId: v.optional(v.id("outboundActions")),
  }),
  handler: async (ctx, args) => {
    const { user } = await requireOrgAccess(ctx, args.organizationId, "member");
    const approval = await ctx.db.get("approvals", args.approvalId);
    if (!approval || approval.organizationId !== args.organizationId) {
      throw new Error("Approval not found");
    }
    if (approval.status !== "pending") {
      throw new Error(`Approval is not pending (status=${approval.status})`);
    }
    if (Date.now() > approval.expiresAt) {
      await ctx.db.patch("approvals", approval._id, {
        status: "expired",
        updatedAt: Date.now(),
      });
      throw new Error("Approval expired");
    }
    if (approval.actionPayloadHash !== args.expectedPayloadHash) {
      throw new Error(
        "Approval payload hash mismatch — proposal was edited; request a new approval",
      );
    }
    if (payloadHash(approval.actionPayloadJson) !== approval.actionPayloadHash) {
      throw new Error("Stored approval payload integrity check failed");
    }

    const now = Date.now();
    await ctx.db.patch("approvals", approval._id, {
      status: args.decision,
      decidedByAuthUserId: user.id,
      decidedAt: now,
      decisionNote: args.decisionNote,
      updatedAt: now,
    });

    const outbound = await ctx.db
      .query("outboundActions")
      .withIndex("by_approval", (q) => q.eq("approvalId", approval._id))
      .unique();

    if (outbound) {
      await ctx.db.patch("outboundActions", outbound._id, {
        status: args.decision === "approved" ? "approved" : "failed",
        updatedAt: now,
      });
    }

    await ctx.db.insert("auditEvents", {
      organizationId: args.organizationId,
      actorAuthUserId: user.id,
      action: `approval.${args.decision}`,
      targetType: "approvals",
      targetId: approval._id,
      metadata: JSON.stringify({ note: args.decisionNote }),
      createdAt: now,
    });

    return {
      status: args.decision,
      outboundActionId: outbound?._id,
    };
  },
});

/**
 * Execute an approved CRM/outbound action with atomic claim.
 * Defaults to dry-run; never performs live GHL/email/SMS writes here.
 * Repeated clicks after claim fail closed.
 */
export const executeApproved = action({
  args: {
    organizationId: v.id("organizations"),
    approvalId: v.id("approvals"),
  },
  returns: v.object({
    status: v.union(
      v.literal("dry_run"),
      v.literal("sent"),
      v.literal("failed"),
      v.literal("unknown"),
    ),
    externalId: v.optional(v.string()),
    detail: v.string(),
    dryRun: v.boolean(),
  }),
  handler: async (
    ctx,
    args,
  ): Promise<{
    status: "dry_run" | "sent" | "failed" | "unknown";
    externalId?: string;
    detail: string;
    dryRun: boolean;
  }> => {
    const org = await ctx.runQuery(api.organizations.get, {
      organizationId: args.organizationId,
    });
    if (!org) throw new Error("Unauthorized");

    const approval = await ctx.runQuery(api.approvals.get, {
      organizationId: args.organizationId,
      approvalId: args.approvalId,
    });
    if (!approval) throw new Error("Approval not found");
    if (approval.status !== "approved") {
      throw new Error(
        `Cannot execute approval in status ${approval.status}; approve first`,
      );
    }

    const actor =
      approval.decidedByAuthUserId ?? approval.proposedByAuthUserId;
    const claim = await ctx.runMutation(internal.outbound.claimForExecution, {
      organizationId: args.organizationId,
      approvalId: args.approvalId,
      actorAuthUserId: actor,
    });
    if (claim.alreadyClaimed) {
      throw new Error(
        "Approval already claimed/consumed (repeated click ignored)",
      );
    }

    await ctx.runMutation(internal.outbound.markSending, {
      outboundActionId: claim.outboundActionId,
    });

    const dryRun = org.outboundDryRun !== false;
    const result: {
      status: "dry_run" | "sent" | "failed";
      externalId?: string;
      detail: string;
    } = await ctx.runAction(internal.ghlActions.executeApprovedDryRun, {
      actionType: approval.actionType,
      payloadJson: approval.actionPayloadJson,
      approvalId: approval._id,
      dryRun,
    });

    const terminal =
      result.status === "dry_run"
        ? ("dry_run" as const)
        : result.status === "sent"
          ? ("sent" as const)
          : ("failed" as const);

    await ctx.runMutation(internal.outbound.markTerminal, {
      outboundActionId: claim.outboundActionId,
      status: terminal,
      externalId: result.externalId,
      resultJson: JSON.stringify({ detail: result.detail }),
    });

    await ctx.runMutation(internal.approvals.recordExecution, {
      organizationId: args.organizationId,
      approvalId: args.approvalId,
      resultStatus: result.status,
      externalId: result.externalId,
      detail: result.detail,
      dryRun,
      actorAuthUserId: actor,
    });

    if (approval.runId && result.status !== "failed") {
      await ctx.runMutation(internal.runSteps.markSucceeded, {
        runId: approval.runId,
      });
    }

    return {
      status: result.status,
      externalId: result.externalId,
      detail: result.detail,
      dryRun,
    };
  },
});

export const recordExecution = internalMutation({
  args: {
    organizationId: v.id("organizations"),
    approvalId: v.id("approvals"),
    resultStatus: v.union(
      v.literal("dry_run"),
      v.literal("sent"),
      v.literal("failed"),
    ),
    externalId: v.optional(v.string()),
    detail: v.string(),
    dryRun: v.boolean(),
    actorAuthUserId: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const approval = await ctx.db.get("approvals", args.approvalId);
    if (!approval || approval.organizationId !== args.organizationId) {
      throw new Error("Approval not found");
    }
    if (approval.status !== "approved" && approval.status !== "executed") {
      throw new Error("Approval not in executable state");
    }

    const now = Date.now();
    const outbound = await ctx.db
      .query("outboundActions")
      .withIndex("by_approval", (q) => q.eq("approvalId", approval._id))
      .unique();

    if (outbound) {
      await ctx.db.patch("outboundActions", outbound._id, {
        status:
          args.resultStatus === "dry_run"
            ? "dry_run"
            : args.resultStatus === "sent"
              ? "sent"
              : "failed",
        dryRun: args.dryRun,
        externalId: args.externalId,
        resultJson: JSON.stringify({ detail: args.detail }),
        updatedAt: now,
      });
    }

    if (args.resultStatus !== "failed") {
      await ctx.db.patch("approvals", approval._id, {
        status: "executed",
        outboundActionId: outbound?._id,
        updatedAt: now,
      });
    }

    await ctx.db.insert("auditEvents", {
      organizationId: args.organizationId,
      actorAuthUserId: args.actorAuthUserId,
      action: "approval.executed",
      targetType: "approvals",
      targetId: approval._id,
      metadata: JSON.stringify({
        resultStatus: args.resultStatus,
        dryRun: args.dryRun,
        externalId: args.externalId,
      }),
      createdAt: now,
    });
    return null;
  },
});
