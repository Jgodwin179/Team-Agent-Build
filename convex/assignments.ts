import { v } from "convex/values";
import type { WorkflowId } from "@convex-dev/workflow";
import { mutation } from "./_generated/server";
import { internal } from "./_generated/api";
import { requireOrgAccess } from "./lib/permissions";
import { workflowManager } from "./workflows/manager";

/**
 * Web assignment ingress:
 * persist inbound event (deduped) → create run → start durable workflow.
 */
export const submit = mutation({
  args: {
    organizationId: v.id("organizations"),
    title: v.string(),
    prompt: v.string(),
    dealId: v.optional(v.id("deals")),
    clientRequestId: v.optional(v.string()),
  },
  returns: v.object({
    runId: v.id("runs"),
    inboundEventId: v.id("inboundEvents"),
    workflowId: v.string(),
    deduplicated: v.boolean(),
  }),
  handler: async (ctx, args): Promise<{
    runId: import("./_generated/dataModel").Id<"runs">;
    inboundEventId: import("./_generated/dataModel").Id<"inboundEvents">;
    workflowId: string;
    deduplicated: boolean;
  }> => {
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

    const providerEventId =
      args.clientRequestId ??
      `web-${user.id}-${args.title.trim()}-${args.prompt.trim().slice(0, 64)}`;
    const dedupeKey = `web:assignment:${providerEventId}`;

    const existingEvent = await ctx.db
      .query("inboundEvents")
      .withIndex("by_dedupe", (q) =>
        q.eq("organizationId", args.organizationId).eq("dedupeKey", dedupeKey),
      )
      .unique();

    if (existingEvent?.runId) {
      const existingRun = await ctx.db.get("runs", existingEvent.runId);
      return {
        runId: existingEvent.runId,
        inboundEventId: existingEvent._id,
        workflowId: existingRun?.workflowId ?? "",
        deduplicated: true,
      };
    }

    const now = Date.now();
    const inboundEventId = await ctx.db.insert("inboundEvents", {
      organizationId: args.organizationId,
      provider: "web",
      providerAccount: "app",
      providerEventId,
      dedupeKey,
      eventType: "assignment.submitted",
      occurredAt: now,
      receivedAt: now,
      payloadJson: JSON.stringify({
        title: args.title.trim(),
        prompt: args.prompt.trim(),
        dealId: args.dealId,
      }),
      status: "received",
      attempts: 0,
    });

    const runId = await ctx.db.insert("runs", {
      organizationId: args.organizationId,
      dealId: args.dealId,
      inboundEventId,
      principalAuthUserId: user.id,
      title: args.title.trim(),
      assignmentPrompt: args.prompt.trim(),
      status: "queued",
      budgetTokens: organization.settings.defaultBudgetTokens ?? 50_000,
      usedTokens: 0,
      maxSteps: organization.settings.maxAgentSteps ?? 4,
      completedSteps: [],
      createdAt: now,
      updatedAt: now,
    });

    await ctx.db.patch("inboundEvents", inboundEventId, {
      status: "claimed",
      runId,
    });

    const workflowId: WorkflowId = await workflowManager.start(
      ctx,
      internal.workflows.assignmentWorkflow.assignmentWorkflow,
      {
        runId,
        organizationId: args.organizationId,
        principalAuthUserId: user.id,
      },
      {
        onComplete: internal.workflows.onComplete.onAssignmentComplete,
        context: { runId },
      },
    );

    await ctx.db.patch("runs", runId, {
      workflowId,
      updatedAt: Date.now(),
    });

    await ctx.db.insert("auditEvents", {
      organizationId: args.organizationId,
      actorAuthUserId: user.id,
      action: "assignment.submitted",
      targetType: "runs",
      targetId: runId,
      metadata: JSON.stringify({ workflowId, inboundEventId }),
      createdAt: Date.now(),
    });

    return {
      runId,
      inboundEventId,
      workflowId,
      deduplicated: false,
    };
  },
});
