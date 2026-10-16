import { v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";
import { internalMutation, mutation, query } from "./_generated/server";
import { internal } from "./_generated/api";
import type { WorkflowId } from "@convex-dev/workflow";
import { requireOrgAccess } from "./lib/permissions";
import { specialistTypeValidator } from "./schema";
import { workflowManager } from "./workflows/manager";

const eventRuleReturn = v.object({
  _id: v.id("eventRules"),
  _creationTime: v.number(),
  organizationId: v.id("organizations"),
  name: v.string(),
  eventType: v.string(),
  provider: v.optional(v.string()),
  enabled: v.boolean(),
  createRunTitle: v.string(),
  createRunPrompt: v.string(),
  dealId: v.optional(v.id("deals")),
  specialistType: v.optional(specialistTypeValidator),
  createdByAuthUserId: v.string(),
  createdAt: v.number(),
  updatedAt: v.number(),
});

export const list = query({
  args: { organizationId: v.id("organizations") },
  returns: v.array(eventRuleReturn),
  handler: async (ctx, args) => {
    await requireOrgAccess(ctx, args.organizationId, "viewer");
    const rows = await ctx.db
      .query("eventRules")
      .withIndex("by_org_and_event_type", (q) =>
        q.eq("organizationId", args.organizationId),
      )
      .collect();
    return rows.sort((a, b) => b.updatedAt - a.updatedAt);
  },
});

export const create = mutation({
  args: {
    organizationId: v.id("organizations"),
    name: v.string(),
    eventType: v.string(),
    provider: v.optional(v.string()),
    createRunTitle: v.string(),
    createRunPrompt: v.string(),
    dealId: v.optional(v.id("deals")),
    specialistType: v.optional(specialistTypeValidator),
    enabled: v.optional(v.boolean()),
  },
  returns: v.id("eventRules"),
  handler: async (ctx, args) => {
    const { user } = await requireOrgAccess(ctx, args.organizationId, "admin");
    const now = Date.now();
    const id = await ctx.db.insert("eventRules", {
      organizationId: args.organizationId,
      name: args.name.trim(),
      eventType: args.eventType.trim(),
      provider: args.provider,
      enabled: args.enabled !== false,
      createRunTitle: args.createRunTitle.trim(),
      createRunPrompt: args.createRunPrompt.trim(),
      dealId: args.dealId,
      specialistType: args.specialistType ?? "coordinator",
      createdByAuthUserId: user.id,
      createdAt: now,
      updatedAt: now,
    });
    await ctx.db.insert("auditEvents", {
      organizationId: args.organizationId,
      actorAuthUserId: user.id,
      action: "eventRule.created",
      targetType: "eventRules",
      targetId: id,
      createdAt: now,
    });
    return id;
  },
});

export const setEnabled = mutation({
  args: {
    organizationId: v.id("organizations"),
    eventRuleId: v.id("eventRules"),
    enabled: v.boolean(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const { user } = await requireOrgAccess(ctx, args.organizationId, "admin");
    const rule = await ctx.db.get("eventRules", args.eventRuleId);
    if (!rule || rule.organizationId !== args.organizationId) {
      throw new Error("Event rule not found");
    }
    await ctx.db.patch("eventRules", rule._id, {
      enabled: args.enabled,
      updatedAt: Date.now(),
    });
    await ctx.db.insert("auditEvents", {
      organizationId: args.organizationId,
      actorAuthUserId: user.id,
      action: args.enabled ? "eventRule.enabled" : "eventRule.disabled",
      targetType: "eventRules",
      targetId: rule._id,
      createdAt: Date.now(),
    });
    return null;
  },
});

/**
 * Apply matching event rules after an inbound event is persisted.
 * Creates durable runs (deduped via inbound event linkage).
 */
export const applyForInboundEvent = internalMutation({
  args: {
    organizationId: v.id("organizations"),
    inboundEventId: v.id("inboundEvents"),
    principalAuthUserId: v.string(),
  },
  returns: v.array(v.id("runs")),
  handler: async (ctx, args) => {
    return await applyRulesForEvent(ctx, args);
  },
});

async function applyRulesForEvent(
  ctx: MutationCtx,
  args: {
    organizationId: Id<"organizations">;
    inboundEventId: Id<"inboundEvents">;
    principalAuthUserId: string;
  },
): Promise<Id<"runs">[]> {
  const event = await ctx.db.get("inboundEvents", args.inboundEventId);
  if (!event || event.organizationId !== args.organizationId) {
    return [];
  }
  const organization = await ctx.db.get("organizations", args.organizationId);
  if (!organization) return [];

  const rules = await ctx.db
    .query("eventRules")
    .withIndex("by_org_and_event_type", (q) =>
      q
        .eq("organizationId", args.organizationId)
        .eq("eventType", event.eventType),
    )
    .collect();

  const matched = rules.filter(
    (r) =>
      r.enabled &&
      (!r.provider || r.provider === event.provider),
  );

  const runIds: Id<"runs">[] = [];
  for (const rule of matched) {
    // One run per rule+inbound event (deterministic)
    const occurrenceKey = `eventRule:${rule._id}:inbound:${event._id}`;
    const existing = await ctx.db
      .query("runs")
      .withIndex("by_occurrence", (q) =>
        q
          .eq("organizationId", args.organizationId)
          .eq("occurrenceKey", occurrenceKey),
      )
      .unique();
    if (existing) {
      runIds.push(existing._id);
      continue;
    }

    const now = Date.now();
    const runId = await ctx.db.insert("runs", {
      organizationId: args.organizationId,
      dealId: rule.dealId ?? undefined,
      inboundEventId: event._id,
      occurrenceKey,
      principalAuthUserId: args.principalAuthUserId,
      title: rule.createRunTitle,
      assignmentPrompt: `${rule.createRunPrompt}\n\n[event ${event.eventType} / ${event.providerEventId}]`,
      specialistType: rule.specialistType ?? "coordinator",
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
      internal.workflows.assignmentWorkflow.assignmentWorkflow,
      {
        runId,
        organizationId: args.organizationId,
        principalAuthUserId: args.principalAuthUserId,
      },
    );
    await ctx.db.patch("runs", runId, {
      workflowId: String(workflowId),
      updatedAt: Date.now(),
    });
    runIds.push(runId);
  }
  return runIds;
}

/** Fixture helper: fire rules for a synthetic inbound event. */
export const fireFixtureEvent = mutation({
  args: {
    organizationId: v.id("organizations"),
    eventType: v.string(),
    provider: v.optional(v.string()),
    providerEventId: v.optional(v.string()),
    payloadJson: v.optional(v.string()),
  },
  returns: v.object({
    inboundEventId: v.id("inboundEvents"),
    runIds: v.array(v.id("runs")),
    deduplicated: v.boolean(),
  }),
  handler: async (ctx, args) => {
    const { user } = await requireOrgAccess(ctx, args.organizationId, "member");
    const providerEventId =
      args.providerEventId ?? `fixture-${args.eventType}-${Date.now()}`;
    const dedupeKey = `eventRuleFixture:${args.eventType}:${providerEventId}`;
    const existing = await ctx.db
      .query("inboundEvents")
      .withIndex("by_dedupe", (q) =>
        q.eq("organizationId", args.organizationId).eq("dedupeKey", dedupeKey),
      )
      .unique();
    if (existing) {
      const runs = await applyRulesForEvent(ctx, {
        organizationId: args.organizationId,
        inboundEventId: existing._id,
        principalAuthUserId: user.id,
      });
      return {
        inboundEventId: existing._id,
        runIds: runs,
        deduplicated: true,
      };
    }
    const now = Date.now();
    const inboundEventId = await ctx.db.insert("inboundEvents", {
      organizationId: args.organizationId,
      provider: args.provider ?? "fixture",
      providerAccount: "app",
      providerEventId,
      dedupeKey,
      eventType: args.eventType,
      occurredAt: now,
      receivedAt: now,
      payloadJson: args.payloadJson ?? "{}",
      status: "received",
      attempts: 0,
    });
    const runIds = await applyRulesForEvent(ctx, {
      organizationId: args.organizationId,
      inboundEventId,
      principalAuthUserId: user.id,
    });
    return { inboundEventId, runIds, deduplicated: false };
  },
});
