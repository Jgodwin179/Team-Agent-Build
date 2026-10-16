import { v } from "convex/values";
import { vResultValidator } from "@convex-dev/workflow";
import { internal } from "../_generated/api";
import { internalMutation } from "../_generated/server";

export const onAssignmentComplete = internalMutation({
  args: {
    workflowId: v.string(),
    result: vResultValidator,
    context: v.object({
      runId: v.id("runs"),
    }),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    if (args.result.kind === "failed") {
      await ctx.runMutation(internal.runSteps.markFailed, {
        runId: args.context.runId,
        errorMessage: args.result.error,
      });
    } else if (args.result.kind === "canceled") {
      await ctx.runMutation(internal.runSteps.markCanceled, {
        runId: args.context.runId,
      });
    }
    return null;
  },
});
