import { v } from "convex/values";
import { createThread } from "@convex-dev/agent";
import type { Id } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";
import { components } from "./_generated/api";
import { internalMutation, internalQuery } from "./_generated/server";
import { assertTransition, isTerminal } from "./lib/runTransitions";

async function getRunOrThrow(ctx: MutationCtx, runId: Id<"runs">) {
  const run = await ctx.db.get("runs", runId);
  if (!run) throw new Error("Run not found");
  return run;
}

function hasStep(run: { completedSteps?: string[] }, step: string) {
  return (run.completedSteps ?? []).includes(step);
}

export const getRunInternal = internalQuery({
  args: { runId: v.id("runs") },
  returns: v.union(
    v.object({
      _id: v.id("runs"),
      organizationId: v.id("organizations"),
      status: v.string(),
      title: v.string(),
      assignmentPrompt: v.optional(v.string()),
      dealId: v.optional(v.id("deals")),
      workflowId: v.optional(v.string()),
      threadId: v.optional(v.string()),
      maxSteps: v.optional(v.number()),
      budgetTokens: v.optional(v.number()),
      usedTokens: v.optional(v.number()),
      completedSteps: v.optional(v.array(v.string())),
      cancelRequested: v.boolean(),
    }),
    v.null(),
  ),
  handler: async (ctx, args) => {
    const run = await ctx.db.get("runs", args.runId);
    if (!run) return null;
    return {
      _id: run._id,
      organizationId: run.organizationId,
      status: run.status,
      title: run.title,
      assignmentPrompt: run.assignmentPrompt,
      dealId: run.dealId,
      workflowId: run.workflowId,
      threadId: run.threadId,
      maxSteps: run.maxSteps,
      budgetTokens: run.budgetTokens,
      usedTokens: run.usedTokens,
      completedSteps: run.completedSteps,
      cancelRequested: run.status === "cancel_requested",
    };
  },
});

export const markRunning = internalMutation({
  args: {
    runId: v.id("runs"),
    workflowId: v.string(),
    modelMode: v.union(v.literal("mock"), v.literal("gateway")),
  },
  returns: v.object({
    canceled: v.boolean(),
    alreadyDone: v.boolean(),
  }),
  handler: async (ctx, args) => {
    const run = await getRunOrThrow(ctx, args.runId);
    if (isTerminal(run.status)) {
      return { canceled: run.status === "canceled", alreadyDone: true };
    }
    if (run.status === "cancel_requested") {
      assertTransition(run.status, "canceled");
      await ctx.db.patch("runs", args.runId, {
        status: "canceled",
        updatedAt: Date.now(),
        completedAt: Date.now(),
        workflowId: args.workflowId,
      });
      return { canceled: true, alreadyDone: false };
    }

    if (!hasStep(run, "markRunning")) {
      assertTransition(run.status, "running");
      const steps = [...(run.completedSteps ?? []), "markRunning"];
      await ctx.db.patch("runs", args.runId, {
        status: "running",
        workflowId: args.workflowId,
        modelMode: args.modelMode,
        startedAt: run.startedAt ?? Date.now(),
        updatedAt: Date.now(),
        completedSteps: steps,
      });
      if (run.inboundEventId) {
        await ctx.db.patch("inboundEvents", run.inboundEventId, {
          status: "processing",
          attempts: 1,
        });
      }
    } else {
      await ctx.db.patch("runs", args.runId, {
        workflowId: args.workflowId,
        modelMode: args.modelMode,
        updatedAt: Date.now(),
      });
    }
    return { canceled: false, alreadyDone: false };
  },
});

export const ensureThread = internalMutation({
  args: {
    runId: v.id("runs"),
    userId: v.string(),
    title: v.string(),
  },
  returns: v.object({
    threadId: v.string(),
    canceled: v.boolean(),
    reused: v.boolean(),
  }),
  handler: async (ctx, args) => {
    const run = await getRunOrThrow(ctx, args.runId);
    if (run.status === "cancel_requested") {
      await ctx.db.patch("runs", args.runId, {
        status: "canceled",
        updatedAt: Date.now(),
        completedAt: Date.now(),
      });
      return { threadId: run.threadId ?? "", canceled: true, reused: false };
    }
    if (isTerminal(run.status)) {
      return {
        threadId: run.threadId ?? "",
        canceled: run.status === "canceled",
        reused: true,
      };
    }
    if (run.threadId && hasStep(run, "ensureThread")) {
      return { threadId: run.threadId, canceled: false, reused: true };
    }

    const threadId = await createThread(ctx, components.agent, {
      userId: args.userId,
      title: args.title,
    });
    const steps = hasStep(run, "ensureThread")
      ? (run.completedSteps ?? [])
      : [...(run.completedSteps ?? []), "ensureThread"];
    await ctx.db.patch("runs", args.runId, {
      threadId,
      completedSteps: steps,
      updatedAt: Date.now(),
    });
    return { threadId, canceled: false, reused: false };
  },
});

export const persistAgentResult = internalMutation({
  args: {
    runId: v.id("runs"),
    text: v.string(),
    modelMode: v.union(v.literal("mock"), v.literal("gateway")),
    inputTokens: v.number(),
    outputTokens: v.number(),
    totalTokens: v.number(),
  },
  returns: v.object({ canceled: v.boolean(), reused: v.boolean() }),
  handler: async (ctx, args) => {
    const run = await getRunOrThrow(ctx, args.runId);
    if (run.status === "cancel_requested") {
      await ctx.db.patch("runs", args.runId, {
        status: "canceled",
        updatedAt: Date.now(),
        completedAt: Date.now(),
      });
      return { canceled: true, reused: false };
    }
    if (hasStep(run, "persistAgentResult") && run.resultSummary) {
      return { canceled: false, reused: true };
    }

    const usedTokens = (run.usedTokens ?? 0) + args.totalTokens;
    if (run.budgetTokens !== undefined && usedTokens > run.budgetTokens) {
      await ctx.db.patch("runs", args.runId, {
        status: "failed",
        errorMessage: `Token budget exceeded (${usedTokens}/${run.budgetTokens})`,
        usedTokens,
        updatedAt: Date.now(),
        completedAt: Date.now(),
      });
      throw new Error("Token budget exceeded");
    }

    const steps = hasStep(run, "persistAgentResult")
      ? (run.completedSteps ?? [])
      : [...(run.completedSteps ?? []), "persistAgentResult"];

    await ctx.db.patch("runs", args.runId, {
      resultSummary: args.text,
      resultJson: JSON.stringify({
        modelMode: args.modelMode,
        text: args.text,
      }),
      modelMode: args.modelMode,
      usedTokens,
      completedSteps: steps,
      updatedAt: Date.now(),
    });

    await ctx.db.insert("usageRecords", {
      organizationId: run.organizationId,
      runId: args.runId,
      model:
        args.modelMode === "mock"
          ? "mock-assignment-agent"
          : "openai/gpt-4o-mini",
      inputTokens: args.inputTokens,
      outputTokens: args.outputTokens,
      totalTokens: args.totalTokens,
      createdAt: Date.now(),
    });

    return { canceled: false, reused: false };
  },
});

export const markSucceeded = internalMutation({
  args: { runId: v.id("runs") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const run = await getRunOrThrow(ctx, args.runId);
    if (run.status === "succeeded" || run.status === "canceled") {
      return null;
    }
    if (run.status === "cancel_requested") {
      await ctx.db.patch("runs", args.runId, {
        status: "canceled",
        updatedAt: Date.now(),
        completedAt: Date.now(),
      });
      return null;
    }
    assertTransition(run.status, "succeeded");
    const steps = hasStep(run, "markSucceeded")
      ? (run.completedSteps ?? [])
      : [...(run.completedSteps ?? []), "markSucceeded"];
    await ctx.db.patch("runs", args.runId, {
      status: "succeeded",
      completedSteps: steps,
      updatedAt: Date.now(),
      completedAt: Date.now(),
      errorMessage: undefined,
    });
    if (run.inboundEventId) {
      await ctx.db.patch("inboundEvents", run.inboundEventId, {
        status: "succeeded",
      });
    }
    return null;
  },
});

export const markFailed = internalMutation({
  args: {
    runId: v.id("runs"),
    errorMessage: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const run = await getRunOrThrow(ctx, args.runId);
    if (run.status === "succeeded" || run.status === "canceled") {
      return null;
    }
    await ctx.db.patch("runs", args.runId, {
      status: "failed",
      errorMessage: args.errorMessage,
      updatedAt: Date.now(),
      completedAt: Date.now(),
    });
    if (run.inboundEventId) {
      await ctx.db.patch("inboundEvents", run.inboundEventId, {
        status: "failed",
        errorMessage: args.errorMessage,
      });
    }
    return null;
  },
});

export const markCanceled = internalMutation({
  args: { runId: v.id("runs") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const run = await getRunOrThrow(ctx, args.runId);
    if (isTerminal(run.status)) return null;
    await ctx.db.patch("runs", args.runId, {
      status: "canceled",
      updatedAt: Date.now(),
      completedAt: Date.now(),
    });
    return null;
  },
});
