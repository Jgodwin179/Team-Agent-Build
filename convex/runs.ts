import { v } from "convex/values";
import type { WorkflowId } from "@convex-dev/workflow";
import { mutation, query } from "./_generated/server";
import { requireOrgAccess } from "./lib/permissions";
import { isTerminal } from "./lib/runTransitions";
import { runStatusValidator } from "./schema";
import { workflowManager } from "./workflows/manager";

const runReturn = v.object({
  _id: v.id("runs"),
  _creationTime: v.number(),
  organizationId: v.id("organizations"),
  dealId: v.optional(v.id("deals")),
  parentRunId: v.optional(v.id("runs")),
  inboundEventId: v.optional(v.id("inboundEvents")),
  scheduleId: v.optional(v.id("schedules")),
  occurrenceKey: v.optional(v.string()),
  workflowId: v.optional(v.string()),
  threadId: v.optional(v.string()),
  principalAuthUserId: v.string(),
  title: v.string(),
  assignmentPrompt: v.optional(v.string()),
  specialistType: v.optional(
    v.union(
      v.literal("coordinator"),
      v.literal("research"),
      v.literal("documents"),
      v.literal("crm"),
      v.literal("communications"),
    ),
  ),
  depth: v.optional(v.number()),
  optionalChild: v.optional(v.boolean()),
  status: runStatusValidator,
  budgetTokens: v.optional(v.number()),
  usedTokens: v.optional(v.number()),
  maxSteps: v.optional(v.number()),
  modelMode: v.optional(v.union(v.literal("mock"), v.literal("gateway"))),
  resultSummary: v.optional(v.string()),
  resultJson: v.optional(v.string()),
  completedSteps: v.optional(v.array(v.string())),
  errorMessage: v.optional(v.string()),
  missingWorkJson: v.optional(v.string()),
  createdAt: v.number(),
  updatedAt: v.number(),
  startedAt: v.optional(v.number()),
  completedAt: v.optional(v.number()),
});

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

export const listToolExecutions = query({
  args: {
    organizationId: v.id("organizations"),
    runId: v.id("runs"),
  },
  returns: v.array(
    v.object({
      _id: v.id("toolExecutions"),
      stepKey: v.string(),
      toolName: v.string(),
      classification: v.union(v.literal("read"), v.literal("write")),
      status: v.string(),
      argsJson: v.string(),
      resultJson: v.optional(v.string()),
      durationMs: v.optional(v.number()),
      createdAt: v.number(),
    }),
  ),
  handler: async (ctx, args) => {
    await requireOrgAccess(ctx, args.organizationId, "viewer");
    const run = await ctx.db.get("runs", args.runId);
    if (!run || run.organizationId !== args.organizationId) {
      return [];
    }
    const rows = await ctx.db
      .query("toolExecutions")
      .withIndex("by_run_and_step", (q) => q.eq("runId", args.runId))
      .collect();
    return rows.map((r) => ({
      _id: r._id,
      stepKey: r.stepKey,
      toolName: r.toolName,
      classification: r.classification,
      status: r.status,
      argsJson: r.argsJson,
      resultJson: r.resultJson,
      durationMs: r.durationMs,
      createdAt: r.createdAt,
    }));
  },
});

export const listUsage = query({
  args: {
    organizationId: v.id("organizations"),
    runId: v.id("runs"),
  },
  returns: v.array(
    v.object({
      _id: v.id("usageRecords"),
      model: v.string(),
      inputTokens: v.number(),
      outputTokens: v.number(),
      totalTokens: v.number(),
      createdAt: v.number(),
    }),
  ),
  handler: async (ctx, args) => {
    await requireOrgAccess(ctx, args.organizationId, "viewer");
    const run = await ctx.db.get("runs", args.runId);
    if (!run || run.organizationId !== args.organizationId) {
      return [];
    }
    const rows = await ctx.db
      .query("usageRecords")
      .withIndex("by_run", (q) => q.eq("runId", args.runId))
      .collect();
    return rows.map((r) => ({
      _id: r._id,
      model: r.model,
      inputTokens: r.inputTokens,
      outputTokens: r.outputTokens,
      totalTokens: r.totalTokens,
      createdAt: r.createdAt,
    }));
  },
});

/** Legacy Phase 1 helper — queues without workflow (kept for manual fixtures). */
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
      maxSteps: organization.settings.maxAgentSteps ?? 4,
      completedSteps: [],
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
    if (isTerminal(run.status)) {
      throw new Error(`Cannot cancel a ${run.status} run`);
    }
    const now = Date.now();
    // Propagate cancel to the run tree (parent + descendants).
    const toVisit = [args.runId];
    const seen = new Set<string>();
    while (toVisit.length > 0) {
      const id = toVisit.pop()!;
      if (seen.has(id)) continue;
      seen.add(id);
      const node = await ctx.db.get("runs", id);
      if (!node || node.organizationId !== args.organizationId) continue;
      const children = await ctx.db
        .query("runs")
        .withIndex("by_parent", (q) => q.eq("parentRunId", id))
        .collect();
      for (const child of children) toVisit.push(child._id);
      if (isTerminal(node.status)) continue;
      await ctx.db.patch("runs", id, {
        status: "cancel_requested",
        updatedAt: now,
      });
      if (node.workflowId) {
        try {
          await workflowManager.cancel(ctx, node.workflowId as WorkflowId);
        } catch (error) {
          console.error("Workflow cancel failed", error);
        }
      }
    }

    await ctx.db.insert("auditEvents", {
      organizationId: args.organizationId,
      actorAuthUserId: user.id,
      action: "run.cancel_requested",
      targetType: "runs",
      targetId: args.runId,
      metadata: JSON.stringify({ propagated: true }),
      createdAt: now,
    });
    return null;
  },
});

/**
 * Resume a failed workflow from journaled steps (does not re-run completed
 * idempotent mutations).
 */
export const resumeFailed = mutation({
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
    if (run.status !== "failed") {
      throw new Error("Only failed runs can be resumed");
    }
    if (!run.workflowId) {
      throw new Error("Run has no workflow to resume");
    }

    await ctx.db.patch("runs", args.runId, {
      status: "running",
      errorMessage: undefined,
      updatedAt: Date.now(),
    });

    await workflowManager.restart(ctx, run.workflowId as WorkflowId);

    await ctx.db.insert("auditEvents", {
      organizationId: args.organizationId,
      actorAuthUserId: user.id,
      action: "run.resume_requested",
      targetType: "runs",
      targetId: args.runId,
      createdAt: Date.now(),
    });
    return null;
  },
});
