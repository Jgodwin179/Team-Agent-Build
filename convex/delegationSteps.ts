import { v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import type { WorkflowId } from "@convex-dev/workflow";
import { internalMutation, internalQuery } from "./_generated/server";
import { internal } from "./_generated/api";
import { specialistTypeValidator } from "./schema";
import { orgDelegationLimits } from "./lib/delegationLimits";
import { workflowManager } from "./workflows/manager";

export const createChildRun = internalMutation({
  args: {
    organizationId: v.id("organizations"),
    parentRunId: v.id("runs"),
    principalAuthUserId: v.string(),
    specialistType: specialistTypeValidator,
    title: v.string(),
    prompt: v.string(),
    optional: v.boolean(),
    budgetTokens: v.optional(v.number()),
    simulateFailure: v.boolean(),
    simulateBudgetExhaustion: v.boolean(),
  },
  returns: v.object({
    childRunId: v.id("runs"),
    workflowId: v.string(),
    rejected: v.boolean(),
    reason: v.optional(v.string()),
  }),
  handler: async (ctx, args) => {
    const parent = await ctx.db.get("runs", args.parentRunId);
    if (!parent || parent.organizationId !== args.organizationId) {
      throw new Error("Parent run not found");
    }
    const organization = await ctx.db.get("organizations", args.organizationId);
    if (!organization) throw new Error("Organization not found");
    const limits = orgDelegationLimits(organization);

    const parentDepth = parent.depth ?? 0;
    const childDepth = parentDepth + 1;
    if (childDepth > limits.maxDelegationDepth) {
      return {
        childRunId: args.parentRunId,
        workflowId: "",
        rejected: true,
        reason: `Depth ${childDepth} exceeds maxDelegationDepth ${limits.maxDelegationDepth}`,
      };
    }
    if (
      !limits.allowRecursiveDelegation &&
      parent.specialistType &&
      parent.specialistType !== "coordinator"
    ) {
      return {
        childRunId: args.parentRunId,
        workflowId: "",
        rejected: true,
        reason: "Recursive delegation disabled (parent is not coordinator)",
      };
    }
    if (args.specialistType === "coordinator") {
      return {
        childRunId: args.parentRunId,
        workflowId: "",
        rejected: true,
        reason: "Cannot delegate to nested coordinator",
      };
    }

    const siblings = await ctx.db
      .query("runs")
      .withIndex("by_parent", (q) => q.eq("parentRunId", args.parentRunId))
      .collect();
    if (siblings.length >= limits.maxChildrenPerRun) {
      return {
        childRunId: args.parentRunId,
        workflowId: "",
        rejected: true,
        reason: `Child limit ${limits.maxChildrenPerRun} reached`,
      };
    }

    const now = Date.now();
    const budget =
      args.budgetTokens ??
      Math.min(10_000, organization.settings.defaultBudgetTokens ?? 50_000);
    const childRunId = await ctx.db.insert("runs", {
      organizationId: args.organizationId,
      dealId: parent.dealId,
      parentRunId: args.parentRunId,
      principalAuthUserId: args.principalAuthUserId,
      title: args.title,
      assignmentPrompt: args.prompt,
      specialistType: args.specialistType,
      depth: childDepth,
      optionalChild: args.optional,
      status: "queued",
      budgetTokens: budget,
      usedTokens: 0,
      maxSteps: 4,
      completedSteps: [],
      createdAt: now,
      updatedAt: now,
    });

    const workflowId: WorkflowId = await workflowManager.start(
      ctx,
      internal.workflows.specialistWorkflow.specialistWorkflow,
      {
        runId: childRunId,
        organizationId: args.organizationId,
        principalAuthUserId: args.principalAuthUserId,
        specialistType: args.specialistType,
        simulateFailure: args.simulateFailure,
        simulateBudgetExhaustion: args.simulateBudgetExhaustion,
      },
    );

    await ctx.db.patch("runs", childRunId, {
      workflowId: String(workflowId),
      updatedAt: Date.now(),
    });

    return {
      childRunId,
      workflowId: String(workflowId),
      rejected: false,
    };
  },
});

export const getChildStatuses = internalQuery({
  args: {
    parentRunId: v.id("runs"),
  },
  returns: v.array(
    v.object({
      _id: v.id("runs"),
      status: v.string(),
      optionalChild: v.boolean(),
      title: v.string(),
      specialistType: v.optional(specialistTypeValidator),
      errorMessage: v.optional(v.string()),
      resultSummary: v.optional(v.string()),
      usedTokens: v.optional(v.number()),
      budgetTokens: v.optional(v.number()),
    }),
  ),
  handler: async (ctx, args) => {
    const children = await ctx.db
      .query("runs")
      .withIndex("by_parent", (q) => q.eq("parentRunId", args.parentRunId))
      .collect();
    return children.map((c) => ({
      _id: c._id,
      status: c.status,
      optionalChild: c.optionalChild === true,
      title: c.title,
      specialistType: c.specialistType,
      errorMessage: c.errorMessage,
      resultSummary: c.resultSummary,
      usedTokens: c.usedTokens,
      budgetTokens: c.budgetTokens,
    }));
  },
});

export const finalizeCoordinator = internalMutation({
  args: {
    runId: v.id("runs"),
  },
  returns: v.object({
    status: v.union(
      v.literal("succeeded"),
      v.literal("failed"),
      v.literal("canceled"),
      v.literal("partial"),
    ),
    missingWork: v.array(v.string()),
  }),
  handler: async (ctx, args) => {
    const parent = await ctx.db.get("runs", args.runId);
    if (!parent) throw new Error("Parent missing");
    if (parent.status === "cancel_requested" || parent.status === "canceled") {
      await ctx.db.patch("runs", args.runId, {
        status: "canceled",
        completedAt: Date.now(),
        updatedAt: Date.now(),
      });
      return { status: "canceled" as const, missingWork: [] };
    }

    const children = await ctx.db
      .query("runs")
      .withIndex("by_parent", (q) => q.eq("parentRunId", args.runId))
      .collect();

    const missingWork: string[] = [];
    let requiredFailed = false;
    let anyCanceled = false;

    for (const child of children) {
      if (child.status === "canceled" || child.status === "cancel_requested") {
        anyCanceled = true;
      }
      if (child.status === "failed" || child.status === "canceled") {
        const label = `${child.specialistType ?? "child"}:${child.title}`;
        if (child.optionalChild) {
          missingWork.push(
            `Optional child failed/canceled — missing work: ${label}${
              child.errorMessage ? ` (${child.errorMessage})` : ""
            }`,
          );
        } else {
          requiredFailed = true;
          missingWork.push(
            `Required child failed — ${label}${
              child.errorMessage ? `: ${child.errorMessage}` : ""
            }`,
          );
        }
      }
    }

    const summaries = children
      .filter((c) => c.status === "succeeded")
      .map(
        (c) =>
          `[${c.specialistType}] ${c.title}: ${c.resultSummary ?? "ok"}`,
      );

    const now = Date.now();
    if (anyCanceled && children.every((c) => c.status === "canceled")) {
      await ctx.db.patch("runs", args.runId, {
        status: "canceled",
        resultSummary: "Coordinator canceled; children canceled.",
        missingWorkJson: JSON.stringify(missingWork),
        completedAt: now,
        updatedAt: now,
      });
      return { status: "canceled" as const, missingWork };
    }

    if (requiredFailed) {
      await ctx.db.patch("runs", args.runId, {
        status: "failed",
        resultSummary: summaries.join("\n") || "Coordinator failed.",
        errorMessage: missingWork.join("; "),
        missingWorkJson: JSON.stringify(missingWork),
        completedAt: now,
        updatedAt: now,
      });
      return { status: "failed" as const, missingWork };
    }

    if (missingWork.length > 0) {
      // Partial success: optional children failed
      await ctx.db.patch("runs", args.runId, {
        status: "succeeded",
        resultSummary: [
          "Coordinator partial result (optional children missing).",
          ...summaries,
          ...missingWork.map((m) => `MISSING: ${m}`),
        ].join("\n"),
        missingWorkJson: JSON.stringify(missingWork),
        completedAt: now,
        updatedAt: now,
      });
      return { status: "partial" as const, missingWork };
    }

    await ctx.db.patch("runs", args.runId, {
      status: "succeeded",
      resultSummary:
        summaries.join("\n") || "Coordinator completed with no children.",
      completedAt: now,
      updatedAt: now,
    });
    return { status: "succeeded" as const, missingWork: [] };
  },
});

export const completeSpecialist = internalMutation({
  args: {
    runId: v.id("runs"),
    ok: v.boolean(),
    summary: v.string(),
    errorMessage: v.optional(v.string()),
    usedTokens: v.number(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const run = await ctx.db.get("runs", args.runId);
    if (!run) throw new Error("Run not found");
    if (run.status === "cancel_requested") {
      await ctx.db.patch("runs", args.runId, {
        status: "canceled",
        completedAt: Date.now(),
        updatedAt: Date.now(),
      });
      return null;
    }
    const now = Date.now();
    if (!args.ok) {
      await ctx.db.patch("runs", args.runId, {
        status: "failed",
        errorMessage: args.errorMessage ?? args.summary,
        resultSummary: args.summary,
        usedTokens: (run.usedTokens ?? 0) + args.usedTokens,
        completedAt: now,
        updatedAt: now,
      });
      return null;
    }
    await ctx.db.patch("runs", args.runId, {
      status: "succeeded",
      resultSummary: args.summary,
      usedTokens: (run.usedTokens ?? 0) + args.usedTokens,
      completedAt: now,
      updatedAt: now,
    });
    return null;
  },
});

/** No-op type export helper for Id usage in workflows. */
export type ChildId = Id<"runs">;
