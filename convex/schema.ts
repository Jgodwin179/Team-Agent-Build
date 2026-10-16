import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export const roleValidator = v.union(
  v.literal("owner"),
  v.literal("admin"),
  v.literal("member"),
  v.literal("viewer"),
);

export const membershipStatusValidator = v.union(
  v.literal("active"),
  v.literal("invited"),
  v.literal("revoked"),
);

export const organizationStatusValidator = v.union(
  v.literal("active"),
  v.literal("suspended"),
);

export const dealStatusValidator = v.union(
  v.literal("intake"),
  v.literal("active"),
  v.literal("on_hold"),
  v.literal("closed"),
);

export const runStatusValidator = v.union(
  v.literal("queued"),
  v.literal("running"),
  v.literal("waiting_for_approval"),
  v.literal("waiting_for_external"),
  v.literal("succeeded"),
  v.literal("failed"),
  v.literal("cancel_requested"),
  v.literal("canceled"),
);

export default defineSchema({
  organizations: defineTable({
    name: v.string(),
    slug: v.string(),
    timezone: v.string(),
    status: organizationStatusValidator,
    outboundDryRun: v.boolean(),
    isTestOrganization: v.boolean(),
    settings: v.object({
      defaultBudgetTokens: v.optional(v.number()),
      maxAgentSteps: v.optional(v.number()),
    }),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_slug", ["slug"])
    .index("by_status", ["status"]),

  memberships: defineTable({
    organizationId: v.id("organizations"),
    authUserId: v.string(),
    role: roleValidator,
    status: membershipStatusValidator,
    createdAt: v.number(),
    updatedAt: v.number(),
    revokedAt: v.optional(v.number()),
  })
    .index("by_user", ["authUserId"])
    .index("by_org_and_user", ["organizationId", "authUserId"])
    .index("by_org_and_status", ["organizationId", "status"]),

  deals: defineTable({
    organizationId: v.id("organizations"),
    title: v.string(),
    ownerAuthUserId: v.string(),
    status: dealStatusValidator,
    externalCRMRef: v.optional(v.string()),
    summary: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_org_and_status", ["organizationId", "status"])
    .index("by_org_and_owner", ["organizationId", "ownerAuthUserId"]),

  runs: defineTable({
    organizationId: v.id("organizations"),
    dealId: v.optional(v.id("deals")),
    parentRunId: v.optional(v.id("runs")),
    workflowId: v.optional(v.string()),
    threadId: v.optional(v.string()),
    principalAuthUserId: v.string(),
    title: v.string(),
    status: runStatusValidator,
    budgetTokens: v.optional(v.number()),
    usedTokens: v.optional(v.number()),
    errorMessage: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
    startedAt: v.optional(v.number()),
    completedAt: v.optional(v.number()),
  })
    .index("by_org_and_status", ["organizationId", "status"])
    .index("by_org_and_deal", ["organizationId", "dealId"])
    .index("by_parent", ["parentRunId"]),

  auditEvents: defineTable({
    organizationId: v.id("organizations"),
    actorAuthUserId: v.string(),
    action: v.string(),
    targetType: v.string(),
    targetId: v.string(),
    metadata: v.optional(v.string()),
    createdAt: v.number(),
  }).index("by_org_and_created", ["organizationId", "createdAt"]),
});
