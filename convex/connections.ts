import { v } from "convex/values";
import { internalQuery, mutation, query } from "./_generated/server";
import { requireOrgAccess, canAdmin } from "./lib/permissions";
import {
  connectionHealthValidator,
  connectionModeValidator,
  connectionProviderValidator,
  connectionStatusValidator,
} from "./schema";
import { GHL_READ_SCOPES, GHL_WRITE_SCOPES } from "./lib/providers/ghlTypes";

const connectionReturn = v.object({
  _id: v.id("connections"),
  _creationTime: v.number(),
  organizationId: v.id("organizations"),
  provider: connectionProviderValidator,
  displayName: v.string(),
  externalAccountLabel: v.string(),
  managedCredentialRef: v.optional(v.string()),
  composioUserId: v.optional(v.string()),
  scopes: v.array(v.string()),
  health: connectionHealthValidator,
  mode: connectionModeValidator,
  ownerAuthUserId: v.string(),
  status: connectionStatusValidator,
  lastError: v.optional(v.string()),
  lastCheckedAt: v.optional(v.number()),
  watchExpiresAt: v.optional(v.number()),
  renewAfterAt: v.optional(v.number()),
  createdAt: v.number(),
  updatedAt: v.number(),
});

const DEFAULT_SCOPES: Record<string, string[]> = {
  box: ["root_readonly", "item_download"],
  google_drive: ["drive.readonly"],
  ghl: [...GHL_READ_SCOPES, ...GHL_WRITE_SCOPES],
  gmail: ["gmail.readonly"],
  google_calendar: ["calendar.readonly"],
};

export const list = query({
  args: {
    organizationId: v.id("organizations"),
    provider: v.optional(connectionProviderValidator),
  },
  returns: v.array(connectionReturn),
  handler: async (ctx, args) => {
    await requireOrgAccess(ctx, args.organizationId, "viewer");
    const rows = await ctx.db
      .query("connections")
      .withIndex("by_org_and_status", (q) =>
        q.eq("organizationId", args.organizationId),
      )
      .collect();
    return rows
      .filter((c) => {
        if (c.status !== "active") return false;
        if (args.provider && c.provider !== args.provider) return false;
        return true;
      })
      .sort((a, b) => b.updatedAt - a.updatedAt);
  },
});

/** Internal lookup for actions (avoids circular public API inference). */
export const getInternal = internalQuery({
  args: {
    organizationId: v.id("organizations"),
    connectionId: v.id("connections"),
  },
  returns: v.union(connectionReturn, v.null()),
  handler: async (ctx, args) => {
    const connection = await ctx.db.get("connections", args.connectionId);
    if (
      !connection ||
      connection.organizationId !== args.organizationId ||
      connection.status !== "active"
    ) {
      return null;
    }
    return connection;
  },
});

/**
 * Create a clearly labeled MOCK connection for local onboarding.
 * Live Composio OAuth link is recorded separately via attachLiveCredential.
 */
export const connectMock = mutation({
  args: {
    organizationId: v.id("organizations"),
    provider: connectionProviderValidator,
    displayName: v.optional(v.string()),
    externalAccountLabel: v.optional(v.string()),
  },
  returns: v.id("connections"),
  handler: async (ctx, args) => {
    const { user, membership } = await requireOrgAccess(
      ctx,
      args.organizationId,
      "admin",
    );
    if (!canAdmin(membership.role)) {
      throw new Error("Unauthorized: requires admin role");
    }
    const now = Date.now();
    const id = await ctx.db.insert("connections", {
      organizationId: args.organizationId,
      provider: args.provider,
      displayName:
        args.displayName ??
        `MOCK ${args.provider.toUpperCase()} connection`,
      externalAccountLabel:
        args.externalAccountLabel ?? `mock-${args.provider}@local.test`,
      scopes: DEFAULT_SCOPES[args.provider] ?? [],
      health: "mock",
      mode: "mock",
      ownerAuthUserId: user.id,
      status: "active",
      createdAt: now,
      updatedAt: now,
      lastCheckedAt: now,
    });
    await ctx.db.insert("auditEvents", {
      organizationId: args.organizationId,
      actorAuthUserId: user.id,
      action: "connection.connect_mock",
      targetType: "connections",
      targetId: id,
      metadata: JSON.stringify({ provider: args.provider }),
      createdAt: now,
    });
    return id;
  },
});

/**
 * Attach a managed Composio connected-account reference for live mode.
 * Does not store OAuth tokens — only the managed credential id.
 */
export const attachLiveCredential = mutation({
  args: {
    organizationId: v.id("organizations"),
    connectionId: v.id("connections"),
    managedCredentialRef: v.string(),
    composioUserId: v.string(),
    scopes: v.optional(v.array(v.string())),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const { user } = await requireOrgAccess(ctx, args.organizationId, "admin");
    const connection = await ctx.db.get("connections", args.connectionId);
    if (!connection || connection.organizationId !== args.organizationId) {
      throw new Error("Connection not found");
    }
    const now = Date.now();
    await ctx.db.patch("connections", args.connectionId, {
      managedCredentialRef: args.managedCredentialRef.trim(),
      composioUserId: args.composioUserId.trim(),
      scopes: args.scopes ?? connection.scopes,
      mode: "live",
      health: "healthy",
      lastError: undefined,
      lastCheckedAt: now,
      updatedAt: now,
    });
    await ctx.db.insert("auditEvents", {
      organizationId: args.organizationId,
      actorAuthUserId: user.id,
      action: "connection.attach_live_credential",
      targetType: "connections",
      targetId: args.connectionId,
      createdAt: now,
    });
    return null;
  },
});

export const markHealth = mutation({
  args: {
    organizationId: v.id("organizations"),
    connectionId: v.id("connections"),
    health: connectionHealthValidator,
    lastError: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    await requireOrgAccess(ctx, args.organizationId, "admin");
    const connection = await ctx.db.get("connections", args.connectionId);
    if (!connection || connection.organizationId !== args.organizationId) {
      throw new Error("Connection not found");
    }
    await ctx.db.patch("connections", args.connectionId, {
      health: args.health,
      lastError: args.lastError,
      lastCheckedAt: Date.now(),
      updatedAt: Date.now(),
    });
    return null;
  },
});

export const disconnect = mutation({
  args: {
    organizationId: v.id("organizations"),
    connectionId: v.id("connections"),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const { user } = await requireOrgAccess(ctx, args.organizationId, "admin");
    const connection = await ctx.db.get("connections", args.connectionId);
    if (!connection || connection.organizationId !== args.organizationId) {
      throw new Error("Connection not found");
    }
    const now = Date.now();
    await ctx.db.patch("connections", args.connectionId, {
      status: "disconnected",
      health: "needs_reconnect",
      managedCredentialRef: undefined,
      updatedAt: now,
    });
    await ctx.db.insert("auditEvents", {
      organizationId: args.organizationId,
      actorAuthUserId: user.id,
      action: "connection.disconnect",
      targetType: "connections",
      targetId: args.connectionId,
      createdAt: now,
    });
    return null;
  },
});

/**
 * Mark connection as needing reconnect (expired auth / revoked scopes).
 * Surfaces in Connections + Ops without deleting history.
 */
export const markNeedsReconnect = mutation({
  args: {
    organizationId: v.id("organizations"),
    connectionId: v.id("connections"),
    reason: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const { user } = await requireOrgAccess(ctx, args.organizationId, "admin");
    const connection = await ctx.db.get("connections", args.connectionId);
    if (!connection || connection.organizationId !== args.organizationId) {
      throw new Error("Connection not found");
    }
    const now = Date.now();
    await ctx.db.patch("connections", args.connectionId, {
      health: "needs_reconnect",
      lastError: args.reason ?? "Reconnect required",
      lastCheckedAt: now,
      updatedAt: now,
    });
    await ctx.db.insert("inboxItems", {
      organizationId: args.organizationId,
      kind: "exception",
      status: "unread",
      title: `Reconnect ${connection.provider}`,
      summary:
        args.reason ??
        `${connection.displayName} needs reconnect before live use.`,
      createdAt: now,
      updatedAt: now,
    });
    await ctx.db.insert("auditEvents", {
      organizationId: args.organizationId,
      actorAuthUserId: user.id,
      action: "connection.needs_reconnect",
      targetType: "connections",
      targetId: args.connectionId,
      metadata: JSON.stringify({ reason: args.reason }),
      createdAt: now,
    });
    return null;
  },
});

/**
 * Record a renew window for watch/subscription-style providers.
 * Does not call live APIs — operators attach a fresh managed credential ref.
 */
export const scheduleRenewal = mutation({
  args: {
    organizationId: v.id("organizations"),
    connectionId: v.id("connections"),
    watchExpiresAt: v.number(),
    renewLeadMs: v.optional(v.number()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const { user } = await requireOrgAccess(ctx, args.organizationId, "admin");
    const connection = await ctx.db.get("connections", args.connectionId);
    if (!connection || connection.organizationId !== args.organizationId) {
      throw new Error("Connection not found");
    }
    const lead = args.renewLeadMs ?? 24 * 60 * 60 * 1000;
    const renewAfterAt = args.watchExpiresAt - lead;
    const now = Date.now();
    await ctx.db.patch("connections", args.connectionId, {
      watchExpiresAt: args.watchExpiresAt,
      renewAfterAt,
      updatedAt: now,
      lastCheckedAt: now,
    });
    await ctx.db.insert("auditEvents", {
      organizationId: args.organizationId,
      actorAuthUserId: user.id,
      action: "connection.renewal_scheduled",
      targetType: "connections",
      targetId: args.connectionId,
      metadata: JSON.stringify({
        watchExpiresAt: args.watchExpiresAt,
        renewAfterAt,
      }),
      createdAt: now,
    });
    return null;
  },
});

/** Connections that need operator attention (reconnect or renew soon). */
export const listNeedingAttention = query({
  args: { organizationId: v.id("organizations") },
  returns: v.array(
    v.object({
      _id: v.id("connections"),
      provider: connectionProviderValidator,
      displayName: v.string(),
      health: connectionHealthValidator,
      mode: connectionModeValidator,
      status: connectionStatusValidator,
      lastError: v.optional(v.string()),
      watchExpiresAt: v.optional(v.number()),
      renewAfterAt: v.optional(v.number()),
      reason: v.string(),
    }),
  ),
  handler: async (ctx, args) => {
    await requireOrgAccess(ctx, args.organizationId, "viewer");
    const now = Date.now();
    const rows = await ctx.db
      .query("connections")
      .withIndex("by_org_and_status", (q) =>
        q.eq("organizationId", args.organizationId),
      )
      .collect();
    const out: Array<{
      _id: typeof rows[0]["_id"];
      provider: (typeof rows)[0]["provider"];
      displayName: string;
      health: (typeof rows)[0]["health"];
      mode: (typeof rows)[0]["mode"];
      status: (typeof rows)[0]["status"];
      lastError?: string;
      watchExpiresAt?: number;
      renewAfterAt?: number;
      reason: string;
    }> = [];
    for (const c of rows) {
      if (c.status === "disconnected" || c.health === "needs_reconnect") {
        out.push({
          _id: c._id,
          provider: c.provider,
          displayName: c.displayName,
          health: c.health,
          mode: c.mode,
          status: c.status,
          lastError: c.lastError,
          watchExpiresAt: c.watchExpiresAt,
          renewAfterAt: c.renewAfterAt,
          reason: c.lastError ?? "Needs reconnect",
        });
        continue;
      }
      if (
        c.health === "expired" ||
        c.health === "error" ||
        (c.renewAfterAt != null && c.renewAfterAt <= now)
      ) {
        out.push({
          _id: c._id,
          provider: c.provider,
          displayName: c.displayName,
          health: c.health,
          mode: c.mode,
          status: c.status,
          lastError: c.lastError,
          watchExpiresAt: c.watchExpiresAt,
          renewAfterAt: c.renewAfterAt,
          reason:
            c.renewAfterAt != null && c.renewAfterAt <= now
              ? "Watch/subscription renew window open"
              : (c.lastError ?? `Health=${c.health}`),
        });
      }
    }
    return out;
  },
});

/**
 * Clear reconnect flag after operator re-attaches credentials.
 * Does not claim live OAuth succeeded — only clears local health when
 * managedCredentialRef is present (or MOCK mode).
 */
export const acknowledgeReconnected = mutation({
  args: {
    organizationId: v.id("organizations"),
    connectionId: v.id("connections"),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const { user } = await requireOrgAccess(ctx, args.organizationId, "admin");
    const connection = await ctx.db.get("connections", args.connectionId);
    if (!connection || connection.organizationId !== args.organizationId) {
      throw new Error("Connection not found");
    }
    if (connection.mode === "live" && !connection.managedCredentialRef) {
      throw new Error(
        "Attach a managed credential ref before acknowledging reconnect",
      );
    }
    const now = Date.now();
    await ctx.db.patch("connections", args.connectionId, {
      status: "active",
      health: connection.mode === "mock" ? "mock" : "healthy",
      lastError: undefined,
      lastCheckedAt: now,
      updatedAt: now,
    });
    await ctx.db.insert("auditEvents", {
      organizationId: args.organizationId,
      actorAuthUserId: user.id,
      action: "connection.reconnected_ack",
      targetType: "connections",
      targetId: args.connectionId,
      createdAt: now,
    });
    return null;
  },
});

export const providerCapabilitySummary = query({
  args: { organizationId: v.id("organizations") },
  returns: v.object({
    composioConfiguredHint: v.string(),
    ghlConfiguredHint: v.string(),
    boxToolkitVersion: v.string(),
    boxTools: v.array(v.string()),
  }),
  handler: async (ctx, args) => {
    await requireOrgAccess(ctx, args.organizationId, "viewer");
    return {
      composioConfiguredHint:
        "Set COMPOSIO_API_KEY on Convex env + attach connected account ref to enable live Box",
      ghlConfiguredHint:
        "Set GHL_API_KEY + GHL_LOCATION_ID on Convex env for live reads; writes stay dry-run",
      boxToolkitVersion: "20260826_00",
      boxTools: [
        "BOX_LIST_ITEMS_IN_FOLDER",
        "BOX_DOWNLOAD_FILE",
        "BOX_GET_FILE_INFORMATION",
      ],
    };
  },
});
