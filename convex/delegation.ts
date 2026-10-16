import { v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import type { WorkflowId } from "@convex-dev/workflow";
import { mutation, query } from "./_generated/server";
import { internal } from "./_generated/api";
import { requireOrgAccess } from "./lib/permissions";
import { specialistTypeValidator } from "./schema";
import { orgDelegationLimits } from "./lib/delegationLimits";
import { workflowManager } from "./workflows/manager";
import { isTerminal } from "./lib/runTransitions";

const childSpec = v.object({
  specialistType: specialistTypeValidator,
  title: v.string(),
  prompt: v.string(),
  optional: v.optional(v.boolean()),
  budgetTokens: v.optional(v.number()),
  /** Fixture: force this child to fail. */
  simulateFailure: v.optional(v.boolean()),
  /** Fixture: consume entire budget immediately. */
  simulateBudgetExhaustion: v.optional(v.boolean()),
});

/**
 * Start a coordinator run that delegates to specialists (bounded tree).
 */
export const startCoordinator = mutation({
  args: {
    organizationId: v.id("organizations"),
    title: v.string(),
    prompt: v.string(),
    dealId: v.optional(v.id("deals")),
    children: v.array(childSpec),
  },
  returns: v.object({
    runId: v.id("runs"),
    workflowId: v.string(),
    childCount: v.number(),
  }),
  handler: async (ctx, args) => {
    const { user, organization } = await requireOrgAccess(
      ctx,
      args.organizationId,
      "member",
    );
    const limits = orgDelegationLimits(organization);
    if (args.children.length > limits.maxChildrenPerRun) {
      throw new Error(
        `Too many children (${args.children.length}); max ${limits.maxChildrenPerRun}`,
      );
    }
    // Reject recursive specialist types as children of specialists later;
    // coordinator depth is 0.
    for (const child of args.children) {
      if (child.specialistType === "coordinator") {
        throw new Error(
          "Cannot nest coordinators as children (no recursive delegation by default)",
        );
      }
    }

    if (args.dealId) {
      const deal = await ctx.db.get("deals", args.dealId);
      if (!deal || deal.organizationId !== args.organizationId) {
        throw new Error("Deal not found");
      }
    }

    const now = Date.now();
    const runId = await ctx.db.insert("runs", {
      organizationId: args.organizationId,
      dealId: args.dealId,
      principalAuthUserId: user.id,
      title: args.title.trim(),
      assignmentPrompt: args.prompt.trim(),
      specialistType: "coordinator",
      depth: 0,
      status: "queued",
      budgetTokens: organization.settings.defaultBudgetTokens ?? 50_000,
      usedTokens: 0,
      maxSteps: organization.settings.maxAgentSteps ?? 8,
      completedSteps: [],
      createdAt: now,
      updatedAt: now,
    });

    const workflowId: WorkflowId = await workflowManager.start(
      ctx,
      internal.workflows.coordinatorWorkflow.coordinatorWorkflow,
      {
        runId,
        organizationId: args.organizationId,
        principalAuthUserId: user.id,
        children: args.children.map((c) => ({
          specialistType: c.specialistType,
          title: c.title,
          prompt: c.prompt,
          optional: c.optional === true,
          budgetTokens: c.budgetTokens,
          simulateFailure: c.simulateFailure === true,
          simulateBudgetExhaustion: c.simulateBudgetExhaustion === true,
        })),
      },
    );

    await ctx.db.patch("runs", runId, {
      workflowId: String(workflowId),
      updatedAt: Date.now(),
    });

    await ctx.db.insert("auditEvents", {
      organizationId: args.organizationId,
      actorAuthUserId: user.id,
      action: "delegation.coordinator_started",
      targetType: "runs",
      targetId: runId,
      metadata: JSON.stringify({ childCount: args.children.length }),
      createdAt: now,
    });

    return {
      runId,
      workflowId: String(workflowId),
      childCount: args.children.length,
    };
  },
});

export const listChildren = query({
  args: {
    organizationId: v.id("organizations"),
    parentRunId: v.id("runs"),
  },
  returns: v.array(
    v.object({
      _id: v.id("runs"),
      title: v.string(),
      status: v.string(),
      specialistType: v.optional(specialistTypeValidator),
      depth: v.optional(v.number()),
      optionalChild: v.optional(v.boolean()),
      resultSummary: v.optional(v.string()),
      errorMessage: v.optional(v.string()),
      missingWorkJson: v.optional(v.string()),
      usedTokens: v.optional(v.number()),
      budgetTokens: v.optional(v.number()),
      createdAt: v.number(),
    }),
  ),
  handler: async (ctx, args) => {
    await requireOrgAccess(ctx, args.organizationId, "viewer");
    const parent = await ctx.db.get("runs", args.parentRunId);
    if (!parent || parent.organizationId !== args.organizationId) {
      return [];
    }
    const children = await ctx.db
      .query("runs")
      .withIndex("by_parent", (q) => q.eq("parentRunId", args.parentRunId))
      .collect();
    return children
      .sort((a, b) => a.createdAt - b.createdAt)
      .map((c) => ({
        _id: c._id,
        title: c.title,
        status: c.status,
        specialistType: c.specialistType,
        depth: c.depth,
        optionalChild: c.optionalChild,
        resultSummary: c.resultSummary,
        errorMessage: c.errorMessage,
        missingWorkJson: c.missingWorkJson,
        usedTokens: c.usedTokens,
        budgetTokens: c.budgetTokens,
        createdAt: c.createdAt,
      }));
  },
});

/**
 * Cancel a run and propagate to all non-terminal children.
 */
export const cancelTree = mutation({
  args: {
    organizationId: v.id("organizations"),
    runId: v.id("runs"),
  },
  returns: v.object({ canceledCount: v.number() }),
  handler: async (ctx, args) => {
    const { user } = await requireOrgAccess(ctx, args.organizationId, "member");
    const root = await ctx.db.get("runs", args.runId);
    if (!root || root.organizationId !== args.organizationId) {
      throw new Error("Run not found");
    }

    const toVisit: Id<"runs">[] = [args.runId];
    const seen = new Set<string>();
    let canceledCount = 0;
    const now = Date.now();

    while (toVisit.length > 0) {
      const id = toVisit.pop()!;
      if (seen.has(id)) continue;
      seen.add(id);
      const run = await ctx.db.get("runs", id);
      if (!run || run.organizationId !== args.organizationId) continue;

      const children = await ctx.db
        .query("runs")
        .withIndex("by_parent", (q) => q.eq("parentRunId", id))
        .collect();
      for (const child of children) {
        toVisit.push(child._id);
      }

      if (isTerminal(run.status)) continue;

      await ctx.db.patch("runs", id, {
        status: "cancel_requested",
        updatedAt: now,
      });
      if (run.workflowId) {
        try {
          await workflowManager.cancel(ctx, run.workflowId as WorkflowId);
        } catch (error) {
          console.error("Workflow cancel failed", error);
        }
      }
      await ctx.db.patch("runs", id, {
        status: "canceled",
        completedAt: Date.now(),
        updatedAt: Date.now(),
      });
      canceledCount++;
    }

    await ctx.db.insert("auditEvents", {
      organizationId: args.organizationId,
      actorAuthUserId: user.id,
      action: "delegation.cancel_tree",
      targetType: "runs",
      targetId: args.runId,
      metadata: JSON.stringify({ canceledCount }),
      createdAt: now,
    });

    return { canceledCount };
  },
});
