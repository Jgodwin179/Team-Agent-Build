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

export const inboundEventStatusValidator = v.union(
  v.literal("received"),
  v.literal("claimed"),
  v.literal("processing"),
  v.literal("succeeded"),
  v.literal("failed"),
);

export const toolExecutionStatusValidator = v.union(
  v.literal("succeeded"),
  v.literal("failed"),
);

export const connectionProviderValidator = v.union(
  v.literal("box"),
  v.literal("google_drive"),
  v.literal("ghl"),
  v.literal("gmail"),
  v.literal("google_calendar"),
);

export const connectionHealthValidator = v.union(
  v.literal("healthy"),
  v.literal("needs_reconnect"),
  v.literal("expired"),
  v.literal("error"),
  v.literal("mock"),
);

export const connectionModeValidator = v.union(
  v.literal("mock"),
  v.literal("live"),
);

export const connectionStatusValidator = v.union(
  v.literal("active"),
  v.literal("disconnected"),
);

export const documentProcessingStatusValidator = v.union(
  v.literal("pending"),
  v.literal("extracting"),
  v.literal("ready"),
  v.literal("error"),
);

export const approvalStatusValidator = v.union(
  v.literal("pending"),
  v.literal("approved"),
  v.literal("rejected"),
  v.literal("executed"),
  v.literal("expired"),
  v.literal("canceled"),
);

export const outboundActionStatusValidator = v.union(
  v.literal("proposed"),
  v.literal("approved"),
  v.literal("claimed"),
  v.literal("dry_run"),
  v.literal("sent"),
  v.literal("failed"),
  v.literal("unknown"),
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
    inboundEventId: v.optional(v.id("inboundEvents")),
    workflowId: v.optional(v.string()),
    threadId: v.optional(v.string()),
    principalAuthUserId: v.string(),
    title: v.string(),
    assignmentPrompt: v.optional(v.string()),
    status: runStatusValidator,
    budgetTokens: v.optional(v.number()),
    usedTokens: v.optional(v.number()),
    maxSteps: v.optional(v.number()),
    modelMode: v.optional(
      v.union(v.literal("mock"), v.literal("gateway")),
    ),
    resultSummary: v.optional(v.string()),
    resultJson: v.optional(v.string()),
    completedSteps: v.optional(v.array(v.string())),
    errorMessage: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
    startedAt: v.optional(v.number()),
    completedAt: v.optional(v.number()),
  })
    .index("by_org_and_status", ["organizationId", "status"])
    .index("by_org_and_deal", ["organizationId", "dealId"])
    .index("by_parent", ["parentRunId"])
    .index("by_workflow", ["workflowId"]),

  inboundEvents: defineTable({
    organizationId: v.id("organizations"),
    provider: v.string(),
    providerAccount: v.string(),
    providerEventId: v.string(),
    dedupeKey: v.string(),
    eventType: v.string(),
    occurredAt: v.number(),
    receivedAt: v.number(),
    payloadJson: v.string(),
    status: inboundEventStatusValidator,
    runId: v.optional(v.id("runs")),
    attempts: v.number(),
    errorMessage: v.optional(v.string()),
  })
    .index("by_dedupe", ["organizationId", "dedupeKey"])
    .index("by_org_and_status", ["organizationId", "status"]),

  toolExecutions: defineTable({
    organizationId: v.id("organizations"),
    runId: v.id("runs"),
    stepKey: v.string(),
    toolName: v.string(),
    toolVersion: v.string(),
    classification: v.union(v.literal("read"), v.literal("write")),
    argsJson: v.string(),
    resultJson: v.optional(v.string()),
    status: toolExecutionStatusValidator,
    durationMs: v.optional(v.number()),
    externalRequestId: v.optional(v.string()),
    createdAt: v.number(),
  }).index("by_run_and_step", ["runId", "stepKey"]),

  usageRecords: defineTable({
    organizationId: v.id("organizations"),
    runId: v.id("runs"),
    model: v.string(),
    inputTokens: v.number(),
    outputTokens: v.number(),
    totalTokens: v.number(),
    estimatedCostUsd: v.optional(v.number()),
    providerRequestId: v.optional(v.string()),
    createdAt: v.number(),
  }).index("by_run", ["runId"]),

  auditEvents: defineTable({
    organizationId: v.id("organizations"),
    actorAuthUserId: v.string(),
    action: v.string(),
    targetType: v.string(),
    targetId: v.string(),
    metadata: v.optional(v.string()),
    createdAt: v.number(),
  }).index("by_org_and_created", ["organizationId", "createdAt"]),

  connections: defineTable({
    organizationId: v.id("organizations"),
    provider: connectionProviderValidator,
    displayName: v.string(),
    externalAccountLabel: v.string(),
    /** Composio connectedAccountId or other managed ref — never raw tokens. */
    managedCredentialRef: v.optional(v.string()),
    composioUserId: v.optional(v.string()),
    scopes: v.array(v.string()),
    health: connectionHealthValidator,
    mode: connectionModeValidator,
    ownerAuthUserId: v.string(),
    status: connectionStatusValidator,
    lastError: v.optional(v.string()),
    lastCheckedAt: v.optional(v.number()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_org_and_provider", ["organizationId", "provider"])
    .index("by_org_and_status", ["organizationId", "status"]),

  documents: defineTable({
    organizationId: v.id("organizations"),
    dealId: v.optional(v.id("deals")),
    title: v.string(),
    sourceProvider: v.string(),
    sourceExternalId: v.optional(v.string()),
    sourceVersion: v.optional(v.string()),
    storageId: v.optional(v.id("_storage")),
    contentHash: v.optional(v.string()),
    contentType: v.string(),
    byteSize: v.optional(v.number()),
    processingStatus: documentProcessingStatusValidator,
    extractionProvider: v.optional(v.string()),
    pageCount: v.optional(v.number()),
    errorMessage: v.optional(v.string()),
    connectionId: v.optional(v.id("connections")),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_org_and_deal", ["organizationId", "dealId"])
    .index("by_org_and_status", ["organizationId", "processingStatus"])
    .index("by_org_source_external", [
      "organizationId",
      "sourceProvider",
      "sourceExternalId",
    ]),

  documentChunks: defineTable({
    organizationId: v.id("organizations"),
    documentId: v.id("documents"),
    dealId: v.optional(v.id("deals")),
    pageNumber: v.number(),
    sectionLabel: v.optional(v.string()),
    text: v.string(),
    createdAt: v.number(),
  })
    .index("by_document_and_page", ["documentId", "pageNumber"])
    .index("by_org_and_deal", ["organizationId", "dealId"]),

  approvals: defineTable({
    organizationId: v.id("organizations"),
    runId: v.optional(v.id("runs")),
    dealId: v.optional(v.id("deals")),
    actionType: v.string(),
    actionPayloadJson: v.string(),
    actionPayloadHash: v.string(),
    proposedByAuthUserId: v.string(),
    status: approvalStatusValidator,
    expiresAt: v.number(),
    decidedByAuthUserId: v.optional(v.string()),
    decidedAt: v.optional(v.number()),
    decisionNote: v.optional(v.string()),
    outboundActionId: v.optional(v.id("outboundActions")),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_org_and_status", ["organizationId", "status"])
    .index("by_run", ["runId"]),

  outboundActions: defineTable({
    organizationId: v.id("organizations"),
    approvalId: v.id("approvals"),
    runId: v.optional(v.id("runs")),
    actionKey: v.string(),
    destination: v.string(),
    payloadHash: v.string(),
    status: outboundActionStatusValidator,
    dryRun: v.boolean(),
    externalId: v.optional(v.string()),
    resultJson: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_approval", ["approvalId"])
    .index("by_org_and_status", ["organizationId", "status"]),
});
