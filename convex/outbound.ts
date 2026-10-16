import { v } from "convex/values";
import { internalMutation, mutation, query } from "./_generated/server";
import { requireOrgAccess } from "./lib/permissions";
import { outboundActionStatusValidator } from "./schema";

/**
 * Atomic claim for outbound execution.
 * Transitions approved → claimed; repeated claims fail closed.
 */
export const claimForExecution = internalMutation({
  args: {
    organizationId: v.id("organizations"),
    approvalId: v.id("approvals"),
    actorAuthUserId: v.string(),
  },
  returns: v.object({
    outboundActionId: v.id("outboundActions"),
    alreadyClaimed: v.boolean(),
  }),
  handler: async (ctx, args) => {
    const approval = await ctx.db.get("approvals", args.approvalId);
    if (!approval || approval.organizationId !== args.organizationId) {
      throw new Error("Approval not found");
    }
    if (approval.status === "executed" || approval.consumedAt) {
      throw new Error("Approval already consumed (repeated click)");
    }
    if (approval.status !== "approved") {
      throw new Error(`Approval not executable (status=${approval.status})`);
    }

    const outbound = await ctx.db
      .query("outboundActions")
      .withIndex("by_approval", (q) => q.eq("approvalId", approval._id))
      .unique();
    if (!outbound) {
      throw new Error("Outbound action missing for approval");
    }
    if (
      outbound.status === "claimed" ||
      outbound.status === "sending" ||
      outbound.status === "sent" ||
      outbound.status === "dry_run" ||
      outbound.status === "unknown"
    ) {
      return { outboundActionId: outbound._id, alreadyClaimed: true };
    }
    if (outbound.status !== "approved") {
      throw new Error(
        `Outbound not in approved state (status=${outbound.status})`,
      );
    }

    const now = Date.now();
    await ctx.db.patch("outboundActions", outbound._id, {
      status: "claimed",
      claimedAt: now,
      claimedBy: args.actorAuthUserId,
      updatedAt: now,
    });
    await ctx.db.patch("approvals", approval._id, {
      consumedAt: now,
      updatedAt: now,
    });

    return { outboundActionId: outbound._id, alreadyClaimed: false };
  },
});

export const markSending = internalMutation({
  args: { outboundActionId: v.id("outboundActions") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const row = await ctx.db.get("outboundActions", args.outboundActionId);
    if (!row) throw new Error("Outbound action not found");
    if (row.status !== "claimed") {
      throw new Error(`Cannot mark sending from ${row.status}`);
    }
    await ctx.db.patch("outboundActions", args.outboundActionId, {
      status: "sending",
      updatedAt: Date.now(),
    });
    return null;
  },
});

export const markTerminal = internalMutation({
  args: {
    outboundActionId: v.id("outboundActions"),
    status: v.union(
      v.literal("dry_run"),
      v.literal("sent"),
      v.literal("failed"),
      v.literal("unknown"),
    ),
    externalId: v.optional(v.string()),
    resultJson: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    await ctx.db.patch("outboundActions", args.outboundActionId, {
      status: args.status,
      externalId: args.externalId,
      resultJson: args.resultJson,
      updatedAt: Date.now(),
    });
    return null;
  },
});

export const listForOrg = query({
  args: {
    organizationId: v.id("organizations"),
    status: v.optional(outboundActionStatusValidator),
  },
  returns: v.array(
    v.object({
      _id: v.id("outboundActions"),
      approvalId: v.id("approvals"),
      actionKey: v.string(),
      destination: v.string(),
      status: outboundActionStatusValidator,
      dryRun: v.boolean(),
      externalId: v.optional(v.string()),
      claimedAt: v.optional(v.number()),
      createdAt: v.number(),
      updatedAt: v.number(),
    }),
  ),
  handler: async (ctx, args) => {
    await requireOrgAccess(ctx, args.organizationId, "viewer");
    let rows = await ctx.db
      .query("outboundActions")
      .withIndex("by_org_and_status", (q) =>
        q.eq("organizationId", args.organizationId),
      )
      .collect();
    if (args.status) {
      rows = rows.filter((r) => r.status === args.status);
    }
    return rows
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .map((r) => ({
        _id: r._id,
        approvalId: r.approvalId,
        actionKey: r.actionKey,
        destination: r.destination,
        status: r.status,
        dryRun: r.dryRun,
        externalId: r.externalId,
        claimedAt: r.claimedAt,
        createdAt: r.createdAt,
        updatedAt: r.updatedAt,
      }));
  },
});

/** Fixture helper: force outbound into ambiguous unknown state. */
export const markUnknownFixture = mutation({
  args: {
    organizationId: v.id("organizations"),
    outboundActionId: v.id("outboundActions"),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    await requireOrgAccess(ctx, args.organizationId, "admin");
    const row = await ctx.db.get("outboundActions", args.outboundActionId);
    if (!row || row.organizationId !== args.organizationId) {
      throw new Error("Outbound action not found");
    }
    await ctx.db.patch("outboundActions", args.outboundActionId, {
      status: "unknown",
      resultJson: JSON.stringify({
        reason: "MOCK fixture — send timed out after possible acceptance",
      }),
      updatedAt: Date.now(),
    });
    return null;
  },
});
