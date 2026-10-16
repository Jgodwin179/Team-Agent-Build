"use node";

import { v } from "convex/values";
import { env, internalAction } from "./_generated/server";
import { createMockGhlClient } from "./lib/providers/ghlMock";
import type { GhlProposal } from "./lib/providers/ghlTypes";

const GHL_API_BASE = "https://services.leadconnectorhq.com";

function ghlConfigured(): boolean {
  return Boolean(env.GHL_API_KEY && env.GHL_LOCATION_ID);
}

async function ghlFetch(
  path: string,
  init?: RequestInit,
): Promise<{ ok: boolean; status: number; body: unknown }> {
  const response = await fetch(`${GHL_API_BASE}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${env.GHL_API_KEY}`,
      Version: "2021-07-28",
      Accept: "application/json",
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
  });
  const text = await response.text();
  let body: unknown = text;
  try {
    body = JSON.parse(text) as unknown;
  } catch {
    // keep text
  }
  return { ok: response.ok, status: response.status, body };
}

export const readContact = internalAction({
  args: {
    mode: v.union(v.literal("mock"), v.literal("live")),
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
  handler: async (_ctx, args) => {
    if (args.mode === "mock" || !ghlConfigured()) {
      const client = createMockGhlClient({
        forceExpired: args.simulate === "expired_auth",
        deniedScopes:
          args.simulate === "denied_scope" ? ["contacts.readonly"] : undefined,
      });
      try {
        const contact = await client.getContact(args.contactId);
        return {
          ok: true,
          mode: "mock" as const,
          mockLabel: "MOCK — local GHL fixture (no live CRM call)",
          contact,
        };
      } catch (error) {
        return {
          ok: false,
          mode: "mock" as const,
          mockLabel: "MOCK — error fixture",
          errorMessage: error instanceof Error ? error.message : String(error),
        };
      }
    }

    const result = await ghlFetch(`/contacts/${args.contactId}`);
    if (!result.ok) {
      return {
        ok: false,
        mode: "live" as const,
        errorMessage: `GHL ${result.status}: ${JSON.stringify(result.body)}`,
      };
    }
    const contact = (result.body as { contact?: Record<string, string> })
      .contact;
    return {
      ok: true,
      mode: "live" as const,
      contact: {
        id: String(contact?.id ?? args.contactId),
        firstName: contact?.firstName,
        lastName: contact?.lastName,
        email: contact?.email,
        phone: contact?.phone,
      },
    };
  },
});

export const searchOpportunities = internalAction({
  args: {
    mode: v.union(v.literal("mock"), v.literal("live")),
    locationId: v.optional(v.string()),
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
  handler: async (_ctx, args) => {
    if (args.mode === "mock" || !ghlConfigured()) {
      const client = createMockGhlClient({
        forceExpired: args.simulate === "expired_auth",
        deniedScopes:
          args.simulate === "denied_scope"
            ? ["opportunities.readonly"]
            : undefined,
      });
      try {
        const result = await client.searchOpportunities({
          locationId: args.locationId ?? "mock-location",
          query: args.query,
          limit: args.limit,
        });
        return {
          ok: true,
          mode: "mock" as const,
          mockLabel: result.mockLabel,
          items: result.items,
        };
      } catch (error) {
        return {
          ok: false,
          mode: "mock" as const,
          mockLabel: "MOCK — error fixture",
          items: [],
          errorMessage: error instanceof Error ? error.message : String(error),
        };
      }
    }

    const locationId = args.locationId ?? env.GHL_LOCATION_ID!;
    // Official opportunities search: POST /opportunities/search
    const result = await ghlFetch(`/opportunities/search`, {
      method: "POST",
      body: JSON.stringify({
        location_id: locationId,
        query: args.query,
        limit: args.limit ?? 20,
      }),
    });
    if (!result.ok) {
      return {
        ok: false,
        mode: "live" as const,
        items: [],
        errorMessage: `GHL ${result.status}: ${JSON.stringify(result.body)}`,
      };
    }
    const opportunities =
      (
        result.body as {
          opportunities?: Array<Record<string, unknown>>;
        }
      ).opportunities ?? [];
    return {
      ok: true,
      mode: "live" as const,
      items: opportunities.map((o) => ({
        id: String(o.id),
        name: String(o.name ?? ""),
        status: o.status ? String(o.status) : undefined,
        pipelineId: o.pipelineId ? String(o.pipelineId) : undefined,
        pipelineStageId: o.pipelineStageId
          ? String(o.pipelineStageId)
          : undefined,
        contactId: o.contactId ? String(o.contactId) : undefined,
        monetaryValue:
          typeof o.monetaryValue === "number" ? o.monetaryValue : undefined,
      })),
    };
  },
});

export const executeApprovedDryRun = internalAction({
  args: {
    actionType: v.string(),
    payloadJson: v.string(),
    approvalId: v.string(),
    /** Phase 3 always true unless ALLOW_LIVE_CRM_WRITES=true (still blocked). */
    dryRun: v.boolean(),
  },
  returns: v.object({
    status: v.union(
      v.literal("dry_run"),
      v.literal("sent"),
      v.literal("failed"),
    ),
    externalId: v.optional(v.string()),
    detail: v.string(),
  }),
  handler: async (_ctx, args) => {
    const allowLive = env.ALLOW_LIVE_CRM_WRITES === "true";
    const dryRun = args.dryRun || !allowLive;
    const proposal = JSON.parse(args.payloadJson) as GhlProposal;

    if (!dryRun) {
      return {
        status: "failed" as const,
        detail:
          "Live GHL writes remain disabled for Phase 3. Unset ALLOW_LIVE_CRM_WRITES; use dry-run only.",
      };
    }

    if (!ghlConfigured() || env.GHL_FORCE_MOCK === "true") {
      const client = createMockGhlClient();
      return await client.executeApproved(proposal, {
        dryRun: true,
        approvalId: args.approvalId,
      });
    }

    // Even with credentials, Phase 3 only returns a dry-run receipt.
    return {
      status: "dry_run" as const,
      externalId: `dryrun_${args.approvalId}`,
      detail: `DRY-RUN: would call GHL for ${proposal.actionType}; no CRM write performed.`,
    };
  },
});
