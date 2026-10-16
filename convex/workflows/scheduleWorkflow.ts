import { v } from "convex/values";
import { internal } from "../_generated/api";
import { resolveModelMode } from "../agents/researchAgent";
import { workflowManager } from "./manager";

/**
 * Durable schedule-triggered run (dry-run / MOCK safe).
 * Marks running → optional coordinator delegation is separate → succeed.
 */
export const scheduleWorkflow = workflowManager.define({
  args: {
    runId: v.id("runs"),
    organizationId: v.id("organizations"),
    principalAuthUserId: v.string(),
    scheduleId: v.id("schedules"),
    occurrenceKey: v.string(),
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
      await step.runMutation(
        internal.scheduleJobs.markOccurrenceTerminal,
        {
          scheduleId: args.scheduleId,
          occurrenceKey: args.occurrenceKey,
          status: started.canceled ? "canceled" : "succeeded",
        },
        { name: "occTerminalEarly" },
      );
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
        { runId: args.runId, errorMessage: "Run missing" },
        { name: "failMissing" },
      );
      await step.runMutation(
        internal.scheduleJobs.markOccurrenceTerminal,
        {
          scheduleId: args.scheduleId,
          occurrenceKey: args.occurrenceKey,
          status: "failed",
        },
        { name: "occFailed" },
      );
      return { status: "failed" as const };
    }
    if (run.cancelRequested) {
      await step.runMutation(
        internal.runSteps.markCanceled,
        { runId: args.runId },
        { name: "markCanceled" },
      );
      await step.runMutation(
        internal.scheduleJobs.markOccurrenceTerminal,
        {
          scheduleId: args.scheduleId,
          occurrenceKey: args.occurrenceKey,
          status: "canceled",
        },
        { name: "occCanceled" },
      );
      return { status: "canceled" as const };
    }

    const summary = [
      "Scheduled job completed (dry-run safe).",
      `Occurrence ${args.occurrenceKey}.`,
      "No live outbound side effects from schedule runner.",
      run.assignmentPrompt
        ? `Prompt: ${run.assignmentPrompt.slice(0, 200)}`
        : "",
    ]
      .filter(Boolean)
      .join(" ");

    await step.runMutation(
      internal.runSteps.persistAgentResult,
      {
        runId: args.runId,
        text: summary,
        modelMode,
        inputTokens: 0,
        outputTokens: 0,
        totalTokens: 0,
      },
      { name: "persistResult" },
    );

    await step.runMutation(
      internal.runSteps.markSucceeded,
      { runId: args.runId },
      { name: "markSucceeded" },
    );

    await step.runMutation(
      internal.scheduleJobs.markOccurrenceTerminal,
      {
        scheduleId: args.scheduleId,
        occurrenceKey: args.occurrenceKey,
        status: "succeeded",
      },
      { name: "occSucceeded" },
    );

    return { status: "succeeded" as const };
  },
});
