import { v } from "convex/values";
import { internal } from "../_generated/api";
import { resolveModelMode } from "../agents/researchAgent";
import { specialistTypeValidator } from "../schema";
import { workflowManager } from "./manager";

/**
 * Bounded specialist run — MOCK work only; no live outbound.
 */
export const specialistWorkflow = workflowManager.define({
  args: {
    runId: v.id("runs"),
    organizationId: v.id("organizations"),
    principalAuthUserId: v.string(),
    specialistType: specialistTypeValidator,
    simulateFailure: v.boolean(),
    simulateBudgetExhaustion: v.boolean(),
  },
  returns: v.object({
    status: v.union(
      v.literal("succeeded"),
      v.literal("canceled"),
      v.literal("failed"),
    ),
  }),
  handler: async (
    step,
    args,
  ): Promise<{ status: "succeeded" | "canceled" | "failed" }> => {
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

    const run = await step.runQuery(
      internal.runSteps.getRunInternal,
      { runId: args.runId },
      { name: "loadRun" },
    );
    if (!run) {
      await step.runMutation(
        internal.runSteps.markFailed,
        { runId: args.runId, errorMessage: "Specialist run missing" },
        { name: "failMissing" },
      );
      return { status: "failed" as const };
    }
    if (run.cancelRequested) {
      await step.runMutation(
        internal.runSteps.markCanceled,
        { runId: args.runId },
        { name: "markCanceled" },
      );
      return { status: "canceled" as const };
    }

    if (args.simulateBudgetExhaustion) {
      const budget = run.budgetTokens ?? 1;
      await step.runMutation(
        internal.delegationSteps.completeSpecialist,
        {
          runId: args.runId,
          ok: false,
          summary: "Budget exhausted before specialist work completed.",
          errorMessage: `Budget exhaustion: used ${budget}/${budget} tokens`,
          usedTokens: budget,
        },
        { name: "budgetFail" },
      );
      return { status: "failed" as const };
    }

    if (args.simulateFailure) {
      await step.runMutation(
        internal.delegationSteps.completeSpecialist,
        {
          runId: args.runId,
          ok: false,
          summary: `Specialist ${args.specialistType} failed (fixture).`,
          errorMessage: "MOCK fixture failure",
          usedTokens: 100,
        },
        { name: "simFail" },
      );
      return { status: "failed" as const };
    }

    // Tiny delay to allow cancel-propagation tests to observe running state.
    await step.sleep(500, { name: "workTick" });

    const again = await step.runQuery(
      internal.runSteps.getRunInternal,
      { runId: args.runId },
      { name: "recheckCancel" },
    );
    if (again?.cancelRequested) {
      await step.runMutation(
        internal.runSteps.markCanceled,
        { runId: args.runId },
        { name: "canceledMid" },
      );
      return { status: "canceled" as const };
    }

    await step.runMutation(
      internal.delegationSteps.completeSpecialist,
      {
        runId: args.runId,
        ok: true,
        summary: `[MOCK ${args.specialistType}] Completed bounded specialist work. ${
          run.assignmentPrompt?.slice(0, 120) ?? ""
        }`,
        usedTokens: 250,
      },
      { name: "completeOk" },
    );

    return { status: "succeeded" as const };
  },
});
