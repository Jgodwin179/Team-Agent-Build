import { v } from "convex/values";
import type { Id } from "../_generated/dataModel";
import { internal } from "../_generated/api";
import { resolveModelMode } from "../agents/researchAgent";
import { specialistTypeValidator } from "../schema";
import { workflowManager } from "./manager";

const childArg = v.object({
  specialistType: specialistTypeValidator,
  title: v.string(),
  prompt: v.string(),
  optional: v.boolean(),
  budgetTokens: v.optional(v.number()),
  simulateFailure: v.boolean(),
  simulateBudgetExhaustion: v.boolean(),
});

/**
 * Coordinator: markRunning → spawn bounded specialist children (parallelism
 * capped) → wait for children → combine / partial result.
 */
export const coordinatorWorkflow = workflowManager.define({
  args: {
    runId: v.id("runs"),
    organizationId: v.id("organizations"),
    principalAuthUserId: v.string(),
    children: v.array(childArg),
  },
  returns: v.object({
    status: v.union(
      v.literal("succeeded"),
      v.literal("canceled"),
      v.literal("failed"),
      v.literal("partial"),
    ),
  }),
  handler: async (
    step,
    args,
  ): Promise<{
    status: "succeeded" | "canceled" | "failed" | "partial";
  }> => {
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

    // Bounded parallelism: create children in waves of 2 (default).
    const parallel = 2;
    const created: Id<"runs">[] = [];
    for (let i = 0; i < args.children.length; i += parallel) {
      const wave = args.children.slice(i, i + parallel);
      for (let j = 0; j < wave.length; j++) {
        const child = wave[j]!;
        const createdChild: {
          childRunId: Id<"runs">;
          workflowId: string;
          rejected: boolean;
          reason?: string;
        } = await step.runMutation(
          internal.delegationSteps.createChildRun,
          {
            organizationId: args.organizationId,
            parentRunId: args.runId,
            principalAuthUserId: args.principalAuthUserId,
            specialistType: child.specialistType,
            title: child.title,
            prompt: child.prompt,
            optional: child.optional,
            budgetTokens: child.budgetTokens,
            simulateFailure: child.simulateFailure,
            simulateBudgetExhaustion: child.simulateBudgetExhaustion,
          },
          { name: `spawn_${i}_${j}` },
        );
        if (!createdChild.rejected) {
          created.push(createdChild.childRunId);
        }
      }
    }

    // Poll until children terminal (bounded wait).
    for (let tick = 0; tick < 60; tick++) {
      const statuses: Array<{
        _id: Id<"runs">;
        status: string;
        optionalChild: boolean;
      }> = await step.runQuery(
        internal.delegationSteps.getChildStatuses,
        { parentRunId: args.runId },
        { name: `waitChildren_${tick}` },
      );
      const pending = statuses.filter(
        (s) =>
          s.status === "queued" ||
          s.status === "running" ||
          s.status === "waiting_for_approval" ||
          s.status === "waiting_for_external" ||
          s.status === "cancel_requested",
      );
      if (pending.length === 0) break;

      const parent = await step.runQuery(
        internal.runSteps.getRunInternal,
        { runId: args.runId },
        { name: `parentCheck_${tick}` },
      );
      if (parent?.cancelRequested) {
        break;
      }
      await step.sleep(2_000, { name: `sleep_${tick}` });
    }

    const final: {
      status: "succeeded" | "failed" | "canceled" | "partial";
      missingWork: string[];
    } = await step.runMutation(
      internal.delegationSteps.finalizeCoordinator,
      { runId: args.runId },
      { name: "finalize" },
    );

    return { status: final.status };
  },
});
