import { v } from "convex/values";
import { internal } from "../_generated/api";
import { resolveModelMode } from "../agents/researchAgent";
import { workflowManager } from "./manager";

/**
 * Durable assignment workflow:
 * markRunning → ensureThread → listOrgDeals (read-only tool) →
 * generateBrief (bounded agent) → persist → succeed
 *
 * Mutation/tool steps are idempotent via completedSteps / toolExecution keys.
 * On failure, workflow restart replays the journal without repeating work.
 */
export const assignmentWorkflow = workflowManager.define({
  args: {
    runId: v.id("runs"),
    organizationId: v.id("organizations"),
    principalAuthUserId: v.string(),
  },
  returns: v.object({
    status: v.union(
      v.literal("succeeded"),
      v.literal("canceled"),
      v.literal("failed"),
    ),
  }),
  handler: async (step, args) => {
    const modelMode = resolveModelMode();

    const started: { canceled: boolean; alreadyDone: boolean } =
      await step.runMutation(
        internal.runSteps.markRunning,
        {
          runId: args.runId,
          workflowId: step.workflowId,
          modelMode,
        },
        { name: "markRunning" },
      );
    if (started.canceled || started.alreadyDone) {
      return {
        status: started.canceled
          ? ("canceled" as const)
          : ("succeeded" as const),
      };
    }

    const thread: {
      threadId: string;
      canceled: boolean;
      reused: boolean;
    } = await step.runMutation(
      internal.runSteps.ensureThread,
      {
        runId: args.runId,
        userId: args.principalAuthUserId,
        title: `Assignment ${args.runId}`,
      },
      { name: "ensureThread" },
    );
    if (thread.canceled) {
      return { status: "canceled" as const };
    }

    const run = await step.runQuery(
      internal.runSteps.getRunInternal,
      { runId: args.runId },
      { name: "loadRun" },
    );
    if (!run) {
      throw new Error("Run missing during workflow");
    }
    if (run.cancelRequested) {
      await step.runMutation(
        internal.runSteps.markCanceled,
        { runId: args.runId },
        { name: "markCanceled" },
      );
      return { status: "canceled" as const };
    }

    const toolResult: {
      deals: Array<{
        id: string;
        title: string;
        status: string;
        summary?: string;
      }>;
      reusedExisting: boolean;
    } = await step.runMutation(
      internal.tools.listOrgDealsInternal,
      {
        organizationId: args.organizationId,
        runId: args.runId,
        limit: 10,
        stepKey: "workflow.listOrgDeals",
      },
      { name: "listOrgDeals" },
    );

    const prompt =
      run.assignmentPrompt ??
      `Prepare a short assignment brief for: ${run.title}.`;

    const brief: {
      text: string;
      modelMode: "mock" | "gateway";
      inputTokens: number;
      outputTokens: number;
      totalTokens: number;
    } = await step.runAction(
      internal.agents.researchAgent.generateAssignmentBrief,
      {
        threadId: thread.threadId,
        prompt,
        toolContextJson: JSON.stringify(toolResult),
        modelMode,
        maxSteps: run.maxSteps ?? 4,
      },
      { name: "generateAssignmentBrief", retry: true },
    );

    const persisted: { canceled: boolean; reused: boolean } =
      await step.runMutation(
        internal.runSteps.persistAgentResult,
        {
          runId: args.runId,
          text: brief.text,
          modelMode: brief.modelMode,
          inputTokens: brief.inputTokens,
          outputTokens: brief.outputTokens,
          totalTokens: brief.totalTokens,
        },
        { name: "persistAgentResult" },
      );
    if (persisted.canceled) {
      return { status: "canceled" as const };
    }

    await step.runMutation(
      internal.runSteps.markSucceeded,
      { runId: args.runId },
      { name: "markSucceeded" },
    );
    return { status: "succeeded" as const };
  },
});
