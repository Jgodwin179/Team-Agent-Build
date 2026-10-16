import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { requireOrgAccess } from "./lib/permissions";
import { runStatusValidator } from "./schema";

const runReturn = v.object({
  _id: v.id("runs"),
  _creationTime: v.number(),
  organizationId: v.id("organizations"),
  dealId: v.optional(v.id("deals")),
  parentRunId: v.optional(v.id("runs")),
  workflowId: v.optional(v.string()),
  threadId: v.optional(v.string()),
  principalAuthUserId: v.string(),
  title: v.string(),
  status: runStatusValidator,
  budgetTokens: v.optional(v.number()),
  usedTokens: v.optional(v.number()),
  errorMessage: v.optional(v.string()),
  createdAt: v.number(),
  updatedAt: v.number(),
  startedAt: v.optional(v.number()),
  completedAt: v.optional(v.number()),
});

const TERMINAL: Set<string> = new Set([
  "succeeded",
  "failed",
  "canceled",
]);

export const list = query({
  args: {
    organizationId: v.id("organizations"),
    dealId: v.optional(v.id("deals")),
    status: v.optional(runStatusValidator),
  },
  returns: v.array(runReturn),
  handler: async (ctx, args) => {
    await requireOrgAccess(ctx, args.organizationId, "viewer");

    let runs;
    if (args.dealId) {
      runs = await ctx.db
        .query("runs")
        .withIndex("by_org_and_deal", (q) =>
          q.eq("organizationId", args.organizationId).eq("dealId", args.dealId),
        )
        .collect();
    } else if (args.status) {
      runs = await ctx.db
        .query("runs")
        .withIndex("by_org_and_status", (q) =>
          q.eq("organizationId", args.organizationId).eq("status", args.status!),
        )
        .collect();
    } else {
      runs = await ctx.db
        .query("runs")
        .withIndex("by_org_and_status", (q) =>
          q.eq("organizationId", args.organizationId),
        )
        .collect();
    }

    return runs.sort((a, b) => b.createdAt - a.createdAt);
  },
});

export const get = query({
  args: {
    organizationId: v.id("organizations"),
    runId: v.id("runs"),
  },
  returns: v.union(runReturn, v.null()),
  handler: async (ctx, args) => {
    await requireOrgAccess(ctx, args.organizationId, "viewer");
    const run = await ctx.db.get("runs", args.runId);
    if (!run || run.organizationId !== args.organizationId) {
      return null;
    }
    return run;
  },
});

export const createQueued = mutation({
  args: {
    organizationId: v.id("organizations"),
    title: v.string(),
    dealId: v.optional(v.id("deals")),
    parentRunId: v.optional(v.id("runs")),
  },
  returns: v.id("runs"),
  handler: async (ctx, args) => {
    const { user, organization } = await requireOrgAccess(
      ctx,
      args.organizationId,
      "member",
    );

    if (args.dealId) {
      const deal = await ctx.db.get("deals", args.dealId);
      if (!deal || deal.organizationId !== args.organizationId) {
        throw new Error("Deal not found in organization");
      }
    }
    if (args.parentRunId) {
      const parent = await ctx.db.get("runs", args.parentRunId);
      if (!parent || parent.organizationId !== args.organizationId) {
        throw new Error("Parent run not found in organization");
      }
    }

    const now = Date.now();
    const runId = await ctx.db.insert("runs", {
      organizationId: args.organizationId,
      dealId: args.dealId,
      parentRunId: args.parentRunId,
      principalAuthUserId: user.id,
      title: args.title.trim(),
      status: "queued",
      budgetTokens: organization.settings.defaultBudgetTokens ?? 50_000,
      usedTokens: 0,
      createdAt: now,
      updatedAt: now,
    });

    await ctx.db.insert("auditEvents", {
      organizationId: args.organizationId,
      actorAuthUserId: user.id,
      action: "run.queued",
      targetType: "runs",
      targetId: runId,
      createdAt: now,
    });

    return runId;
  },
});

export const requestCancel = mutation({
  args: {
    organizationId: v.id("organizations"),
    runId: v.id("runs"),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const { user } = await requireOrgAccess(ctx, args.organizationId, "member");
    const run = await ctx.db.get("runs", args.runId);
    if (!run || run.organizationId !== args.organizationId) {
      throw new Error("Run not found");
    }
    if (TERMINAL.has(run.status)) {
      throw new Error(`Cannot cancel a ${run.status} run`);
    }
    const now = Date.now();
    await ctx.db.patch("runs", args.runId, {
      status: "cancel_requested",
      updatedAt: now,
    });
    await ctx.db.insert("auditEvents", {
      organizationId: args.organizationId,
      actorAuthUserId: user.id,
      action: "run.cancel_requested",
      targetType: "runs",
      targetId: args.runId,
      createdAt: now,
    });
    return null;
  },
});
