import { v } from "convex/values";
import { action, mutation, query } from "./_generated/server";
import { api, internal } from "./_generated/api";
import type { Doc } from "./_generated/dataModel";
import { requireOrgAccess } from "./lib/permissions";
import { payloadHash } from "./lib/hash";
import {
  GHL_ALLOWED_OPPORTUNITY_FIELDS,
  type GhlProposal,
} from "./lib/providers/ghlTypes";
import { summarizeProposal } from "./lib/providers/ghlMock";

type ContactReadResult = {
  ok: boolean;
  mode: "mock" | "live";
  mockLabel?: string;
  contact?: {
    id: string;
    firstName?: string;
    lastName?: string;
    email?: string;
    phone?: string;
  };
  errorMessage?: string;
};

type OpportunityListResult = {
  ok: boolean;
  mode: "mock" | "live";
  mockLabel?: string;
  items: Array<{
    id: string;
    name: string;
    status?: string;
    pipelineId?: string;
    pipelineStageId?: string;
    contactId?: string;
    monetaryValue?: number;
  }>;
  errorMessage?: string;
};

const proposalReturn = v.object({
  approvalId: v.id("approvals"),
  actionType: v.string(),
  actionPayloadHash: v.string(),
  summary: v.string(),
  expiresAt: v.number(),
  status: v.string(),
});

export const getContact = action({
  args: {
    organizationId: v.id("organizations"),
    connectionId: v.id("connections"),
    contactId: v.string(),
    simulate: v.optional(
      v.union(v.literal("expired_auth"), v.literal("denied_scope")),
    ),
  },
  returns: v.object({
    ok: v.boolean(),
    mode: v.union(v.literal("mock"), v.literal("live")),
    mockLabel: v.optional(v.string()),
    contact: v.optional(
      v.object({
        id: v.string(),
        firstName: v.optional(v.string()),
        lastName: v.optional(v.string()),
        email: v.optional(v.string()),
        phone: v.optional(v.string()),
      }),
    ),
    errorMessage: v.optional(v.string()),
  }),
  handler: async (ctx, args): Promise<ContactReadResult> => {
    const org = await ctx.runQuery(api.organizations.get, {
      organizationId: args.organizationId,
    });
    if (!org) throw new Error("Unauthorized");
    const connection: Doc<"connections"> | null = await ctx.runQuery(
      internal.connections.getInternal,
      {
        organizationId: args.organizationId,
        connectionId: args.connectionId,
      },
    );
    if (!connection || connection.provider !== "ghl") {
      throw new Error("GHL connection not found");
    }

    return await ctx.runAction(internal.ghlActions.readContact, {
      mode: connection.mode,
      contactId: args.contactId,
      simulate: args.simulate,
    });
  },
});

export const listOpportunities = action({
  args: {
    organizationId: v.id("organizations"),
    connectionId: v.id("connections"),
    query: v.optional(v.string()),
    limit: v.optional(v.number()),
    simulate: v.optional(
      v.union(v.literal("expired_auth"), v.literal("denied_scope")),
    ),
  },
  returns: v.object({
    ok: v.boolean(),
    mode: v.union(v.literal("mock"), v.literal("live")),
    mockLabel: v.optional(v.string()),
    items: v.array(
      v.object({
        id: v.string(),
        name: v.string(),
        status: v.optional(v.string()),
        pipelineId: v.optional(v.string()),
        pipelineStageId: v.optional(v.string()),
        contactId: v.optional(v.string()),
        monetaryValue: v.optional(v.number()),
      }),
    ),
    errorMessage: v.optional(v.string()),
  }),
  handler: async (ctx, args): Promise<OpportunityListResult> => {
    const org = await ctx.runQuery(api.organizations.get, {
      organizationId: args.organizationId,
    });
    if (!org) throw new Error("Unauthorized");
    const connection: Doc<"connections"> | null = await ctx.runQuery(
      internal.connections.getInternal,
      {
        organizationId: args.organizationId,
        connectionId: args.connectionId,
      },
    );
    if (!connection || connection.provider !== "ghl") {
      throw new Error("GHL connection not found");
    }

    return await ctx.runAction(internal.ghlActions.searchOpportunities, {
      mode: connection.mode,
      query: args.query,
      limit: args.limit,
      simulate: args.simulate,
    });
  },
});

/**
 * Propose a GHL note or opportunity update. Creates a pending approval;
 * does not write to CRM.
 */
export const proposeUpdate = mutation({
  args: {
    organizationId: v.id("organizations"),
    dealId: v.optional(v.id("deals")),
    runId: v.optional(v.id("runs")),
    actionType: v.union(
      v.literal("ghl.add_note"),
      v.literal("ghl.update_opportunity"),
    ),
    contactId: v.optional(v.string()),
    noteBody: v.optional(v.string()),
    opportunityId: v.optional(v.string()),
    opportunityPatch: v.optional(
      v.object({
        name: v.optional(v.string()),
        status: v.optional(v.string()),
        pipelineStageId: v.optional(v.string()),
        monetaryValue: v.optional(v.number()),
      }),
    ),
    expiresInMs: v.optional(v.number()),
  },
  returns: proposalReturn,
  handler: async (ctx, args) => {
    const { user, organization } = await requireOrgAccess(
      ctx,
      args.organizationId,
      "member",
    );

    let proposal: GhlProposal;
    if (args.actionType === "ghl.add_note") {
      if (!args.contactId || !args.noteBody?.trim()) {
        throw new Error("contactId and noteBody are required for ghl.add_note");
      }
      proposal = {
        actionType: "ghl.add_note",
        contactId: args.contactId,
        body: args.noteBody.trim(),
      };
    } else {
      if (!args.opportunityId || !args.opportunityPatch) {
        throw new Error(
          "opportunityId and opportunityPatch are required for ghl.update_opportunity",
        );
      }
      const patch: {
        name?: string;
        status?: string;
        pipelineStageId?: string;
        monetaryValue?: number;
      } = {};
      if (args.opportunityPatch.name !== undefined) {
        patch.name = args.opportunityPatch.name;
      }
      if (args.opportunityPatch.status !== undefined) {
        patch.status = args.opportunityPatch.status;
      }
      if (args.opportunityPatch.pipelineStageId !== undefined) {
        patch.pipelineStageId = args.opportunityPatch.pipelineStageId;
      }
      if (args.opportunityPatch.monetaryValue !== undefined) {
        patch.monetaryValue = args.opportunityPatch.monetaryValue;
      }
      void GHL_ALLOWED_OPPORTUNITY_FIELDS;
      if (Object.keys(patch).length === 0) {
        throw new Error("No allowlisted opportunity fields provided");
      }
      proposal = {
        actionType: "ghl.update_opportunity",
        opportunityId: args.opportunityId,
        patch,
      };
    }

    const actionPayloadJson = JSON.stringify(proposal);
    const actionPayloadHash = payloadHash(actionPayloadJson);
    const now = Date.now();
    const expiresAt = now + (args.expiresInMs ?? 24 * 60 * 60 * 1000);

    const approvalId = await ctx.db.insert("approvals", {
      organizationId: args.organizationId,
      runId: args.runId,
      dealId: args.dealId,
      actionType: proposal.actionType,
      actionPayloadJson,
      actionPayloadHash,
      proposedByAuthUserId: user.id,
      status: "pending",
      expiresAt,
      createdAt: now,
      updatedAt: now,
    });

    await ctx.db.insert("outboundActions", {
      organizationId: args.organizationId,
      approvalId,
      runId: args.runId,
      actionKey: `${proposal.actionType}:${actionPayloadHash}`,
      destination:
        proposal.actionType === "ghl.add_note"
          ? `ghl:contact:${proposal.contactId}`
          : `ghl:opportunity:${proposal.opportunityId}`,
      payloadHash: actionPayloadHash,
      status: "proposed",
      dryRun: organization.outboundDryRun !== false,
      createdAt: now,
      updatedAt: now,
    });

    await ctx.db.insert("auditEvents", {
      organizationId: args.organizationId,
      actorAuthUserId: user.id,
      action: "crm.propose_update",
      targetType: "approvals",
      targetId: approvalId,
      metadata: JSON.stringify({
        actionType: proposal.actionType,
        hash: actionPayloadHash,
      }),
      createdAt: now,
    });

    return {
      approvalId,
      actionType: proposal.actionType,
      actionPayloadHash,
      summary: summarizeProposal(proposal),
      expiresAt,
      status: "pending",
    };
  },
});

export const listPendingApprovals = query({
  args: { organizationId: v.id("organizations") },
  returns: v.array(
    v.object({
      _id: v.id("approvals"),
      actionType: v.string(),
      actionPayloadJson: v.string(),
      actionPayloadHash: v.string(),
      summary: v.string(),
      status: v.string(),
      expiresAt: v.number(),
      proposedByAuthUserId: v.string(),
      dealId: v.optional(v.id("deals")),
      createdAt: v.number(),
    }),
  ),
  handler: async (ctx, args) => {
    await requireOrgAccess(ctx, args.organizationId, "viewer");
    const pending = await ctx.db
      .query("approvals")
      .withIndex("by_org_and_status", (q) =>
        q.eq("organizationId", args.organizationId).eq("status", "pending"),
      )
      .collect();
    const approved = await ctx.db
      .query("approvals")
      .withIndex("by_org_and_status", (q) =>
        q.eq("organizationId", args.organizationId).eq("status", "approved"),
      )
      .collect();
    return [...pending, ...approved]
      .sort((a, b) => b.createdAt - a.createdAt)
      .map((a) => ({
        _id: a._id,
        actionType: a.actionType,
        actionPayloadJson: a.actionPayloadJson,
        actionPayloadHash: a.actionPayloadHash,
        summary: summarizeProposal(
          JSON.parse(a.actionPayloadJson) as GhlProposal,
        ),
        status: a.status,
        expiresAt: a.expiresAt,
        proposedByAuthUserId: a.proposedByAuthUserId,
        dealId: a.dealId,
        createdAt: a.createdAt,
      }));
  },
});
