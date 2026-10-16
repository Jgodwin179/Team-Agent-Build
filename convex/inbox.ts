import { v } from "convex/values";
import { internalMutation, mutation, query } from "./_generated/server";
import { requireOrgAccess } from "./lib/permissions";
import {
  inboxItemKindValidator,
  inboxItemStatusValidator,
} from "./schema";

const inboxItemReturn = v.object({
  _id: v.id("inboxItems"),
  organizationId: v.id("organizations"),
  kind: inboxItemKindValidator,
  status: inboxItemStatusValidator,
  title: v.string(),
  summary: v.string(),
  dealId: v.optional(v.id("deals")),
  runId: v.optional(v.id("runs")),
  approvalId: v.optional(v.id("approvals")),
  associationReviewId: v.optional(v.id("associationReviews")),
  secureLinkPath: v.optional(v.string()),
  createdAt: v.number(),
  updatedAt: v.number(),
});

export const list = query({
  args: {
    organizationId: v.id("organizations"),
    status: v.optional(inboxItemStatusValidator),
    kind: v.optional(inboxItemKindValidator),
  },
  returns: v.array(inboxItemReturn),
  handler: async (ctx, args) => {
    await requireOrgAccess(ctx, args.organizationId, "viewer");
    let rows = await ctx.db
      .query("inboxItems")
      .withIndex("by_org_and_status", (q) =>
        q.eq("organizationId", args.organizationId),
      )
      .collect();
    if (args.status) {
      rows = rows.filter((r) => r.status === args.status);
    } else {
      rows = rows.filter((r) => r.status === "unread" || r.status === "open");
    }
    if (args.kind) {
      rows = rows.filter((r) => r.kind === args.kind);
    }
    return rows.sort((a, b) => b.createdAt - a.createdAt);
  },
});

export const createInternal = internalMutation({
  args: {
    organizationId: v.id("organizations"),
    kind: inboxItemKindValidator,
    title: v.string(),
    summary: v.string(),
    dealId: v.optional(v.id("deals")),
    runId: v.optional(v.id("runs")),
    approvalId: v.optional(v.id("approvals")),
    associationReviewId: v.optional(v.id("associationReviews")),
    inboundEventId: v.optional(v.id("inboundEvents")),
    assigneeAuthUserId: v.optional(v.string()),
    secureLinkPath: v.optional(v.string()),
  },
  returns: v.id("inboxItems"),
  handler: async (ctx, args) => {
    const now = Date.now();
    return await ctx.db.insert("inboxItems", {
      organizationId: args.organizationId,
      kind: args.kind,
      status: "unread",
      title: args.title,
      summary: args.summary,
      dealId: args.dealId,
      runId: args.runId,
      approvalId: args.approvalId,
      associationReviewId: args.associationReviewId,
      inboundEventId: args.inboundEventId,
      assigneeAuthUserId: args.assigneeAuthUserId,
      secureLinkPath: args.secureLinkPath,
      createdAt: now,
      updatedAt: now,
    });
  },
});

export const resolve = mutation({
  args: {
    organizationId: v.id("organizations"),
    inboxItemId: v.id("inboxItems"),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    await requireOrgAccess(ctx, args.organizationId, "member");
    const item = await ctx.db.get("inboxItems", args.inboxItemId);
    if (!item || item.organizationId !== args.organizationId) {
      throw new Error("Inbox item not found");
    }
    await ctx.db.patch("inboxItems", args.inboxItemId, {
      status: "resolved",
      updatedAt: Date.now(),
    });
    return null;
  },
});

export const resolveAssociation = mutation({
  args: {
    organizationId: v.id("organizations"),
    associationReviewId: v.id("associationReviews"),
    dealId: v.id("deals"),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const { user } = await requireOrgAccess(ctx, args.organizationId, "member");
    const review = await ctx.db.get(
      "associationReviews",
      args.associationReviewId,
    );
    if (!review || review.organizationId !== args.organizationId) {
      throw new Error("Association review not found");
    }
    if (review.status !== "pending_review") {
      throw new Error("Association review already resolved");
    }
    const deal = await ctx.db.get("deals", args.dealId);
    if (!deal || deal.organizationId !== args.organizationId) {
      throw new Error("Deal not found");
    }
    const now = Date.now();
    await ctx.db.patch("associationReviews", review._id, {
      status: "resolved",
      resolvedDealId: args.dealId,
      resolvedByAuthUserId: user.id,
      updatedAt: now,
    });
    if (review.runId) {
      await ctx.db.patch("runs", review.runId, {
        dealId: args.dealId,
        updatedAt: now,
      });
    }
    const items = await ctx.db
      .query("inboxItems")
      .withIndex("by_org_and_kind", (q) =>
        q
          .eq("organizationId", args.organizationId)
          .eq("kind", "association_review"),
      )
      .collect();
    for (const item of items) {
      if (item.associationReviewId === review._id) {
        await ctx.db.patch("inboxItems", item._id, {
          status: "resolved",
          dealId: args.dealId,
          updatedAt: now,
        });
      }
    }
    return null;
  },
});

export const listAssociationReviews = query({
  args: { organizationId: v.id("organizations") },
  returns: v.array(
    v.object({
      _id: v.id("associationReviews"),
      reason: v.string(),
      status: v.string(),
      candidateDealIds: v.array(v.id("deals")),
      resolvedDealId: v.optional(v.id("deals")),
      runId: v.optional(v.id("runs")),
      createdAt: v.number(),
    }),
  ),
  handler: async (ctx, args) => {
    await requireOrgAccess(ctx, args.organizationId, "viewer");
    const rows = await ctx.db
      .query("associationReviews")
      .withIndex("by_org_and_status", (q) =>
        q
          .eq("organizationId", args.organizationId)
          .eq("status", "pending_review"),
      )
      .collect();
    return rows.map((r) => ({
      _id: r._id,
      reason: r.reason,
      status: r.status,
      candidateDealIds: r.candidateDealIds,
      resolvedDealId: r.resolvedDealId,
      runId: r.runId,
      createdAt: r.createdAt,
    }));
  },
});
