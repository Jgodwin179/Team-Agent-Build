import { v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import { mutation } from "./_generated/server";
import { requireAuthUser } from "./lib/permissions";

const DEMO_ORG_SLUG = "demo-brokerage";
const SECOND_ORG_SLUG = "demo-peer-firm";

/**
 * Ensures the signed-in user has access to the default test organization
 * (outbound dry-run enabled) and a second org for cross-tenant denial tests.
 * Safe to call repeatedly.
 */
export const ensureDevWorkspace = mutation({
  args: {},
  returns: v.object({
    primaryOrganizationId: v.id("organizations"),
    secondaryOrganizationId: v.id("organizations"),
    createdPrimary: v.boolean(),
    createdSecondary: v.boolean(),
  }),
  handler: async (ctx) => {
    const user = await requireAuthUser(ctx);
    const now = Date.now();

    let createdPrimary = false;
    let createdSecondary = false;

    let primary = await ctx.db
      .query("organizations")
      .withIndex("by_slug", (q) => q.eq("slug", DEMO_ORG_SLUG))
      .unique();

    if (!primary) {
      const organizationId = await ctx.db.insert("organizations", {
        name: "Demo Brokerage (Test)",
        slug: DEMO_ORG_SLUG,
        timezone: "America/New_York",
        status: "active",
        outboundDryRun: true,
        isTestOrganization: true,
        settings: {
          defaultBudgetTokens: 50_000,
          maxAgentSteps: 12,
          schedulesEnabled: false,
          maxDelegationDepth: 1,
          maxChildrenPerRun: 4,
          maxParallelChildren: 2,
          allowRecursiveDelegation: false,
        },
        createdAt: now,
        updatedAt: now,
      });
      primary = (await ctx.db.get("organizations", organizationId))!;
      createdPrimary = true;
    }

    let secondary = await ctx.db
      .query("organizations")
      .withIndex("by_slug", (q) => q.eq("slug", SECOND_ORG_SLUG))
      .unique();

    if (!secondary) {
      const organizationId = await ctx.db.insert("organizations", {
        name: "Peer Firm (Isolation Test)",
        slug: SECOND_ORG_SLUG,
        timezone: "America/New_York",
        status: "active",
        outboundDryRun: true,
        isTestOrganization: true,
        settings: {
          defaultBudgetTokens: 25_000,
          maxAgentSteps: 8,
          schedulesEnabled: false,
          maxDelegationDepth: 1,
          maxChildrenPerRun: 4,
          maxParallelChildren: 2,
          allowRecursiveDelegation: false,
        },
        createdAt: now,
        updatedAt: now,
      });
      secondary = (await ctx.db.get("organizations", organizationId))!;
      createdSecondary = true;
    }

    async function ensureMembership(
      organizationId: Id<"organizations">,
      role: "owner" | "member",
    ) {
      const existing = await ctx.db
        .query("memberships")
        .withIndex("by_org_and_user", (q) =>
          q.eq("organizationId", organizationId).eq("authUserId", user.id),
        )
        .unique();
      if (existing) {
        if (existing.status !== "active") {
          await ctx.db.patch("memberships", existing._id, {
            status: "active",
            role,
            revokedAt: undefined,
            updatedAt: Date.now(),
          });
        }
        return;
      }
      await ctx.db.insert("memberships", {
        organizationId,
        authUserId: user.id,
        role,
        status: "active",
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
    }

    await ensureMembership(primary._id, "owner");
    await ensureMembership(secondary._id, "owner");

    const existingDeals = await ctx.db
      .query("deals")
      .withIndex("by_org_and_status", (q) =>
        q.eq("organizationId", primary._id),
      )
      .take(1);

    if (existingDeals.length === 0) {
      const dealId = await ctx.db.insert("deals", {
        organizationId: primary._id,
        title: "Sample Seller — Midwest Manufacturing",
        ownerAuthUserId: user.id,
        status: "intake",
        summary:
          "Seed deal for local development. Outbound actions remain in dry-run.",
        createdAt: now,
        updatedAt: now,
      });
      await ctx.db.insert("runs", {
        organizationId: primary._id,
        dealId,
        principalAuthUserId: user.id,
        title: "Seed placeholder run (queued)",
        status: "queued",
        budgetTokens: 50_000,
        usedTokens: 0,
        createdAt: now,
        updatedAt: now,
      });
    }

    return {
      primaryOrganizationId: primary._id,
      secondaryOrganizationId: secondary._id,
      createdPrimary,
      createdSecondary,
    };
  },
});
