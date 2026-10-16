"use node";

import { v } from "convex/values";
import { env, internalAction } from "./_generated/server";
import { createMockBoxFileSource } from "./lib/providers/boxMock";
import {
  BOX_TOOL_SLUGS,
  COMPOSIO_BOX_TOOLKIT_VERSION,
  FileSourceError,
} from "./lib/providers/fileSource";

type ListResult = {
  items: Array<{
    id: string;
    name: string;
    type: string;
    size?: number;
    modifiedAt?: string;
  }>;
  nextOffset?: number;
  nextMarker?: string;
  mode: "mock" | "live";
  mockLabel?: string;
  errorCode?: string;
};

type DownloadResult = {
  ok: boolean;
  mode: "mock" | "live";
  mockLabel?: string;
  fileId?: string;
  name?: string;
  contentType?: string;
  /** Base64 payload for Convex storage handoff. */
  contentBase64?: string;
  errorCode?: string;
  errorMessage?: string;
};

function composioConfigured(): boolean {
  return Boolean(env.COMPOSIO_API_KEY);
}

async function executeComposioBox(
  slug: string,
  args: {
    userId: string;
    connectedAccountId: string;
    arguments: Record<string, unknown>;
  },
): Promise<{ successful?: boolean; data?: unknown; error?: string }> {
  const { Composio } = await import("@composio/core");
  const composio = new Composio({
    apiKey: env.COMPOSIO_API_KEY,
    toolkitVersions: { box: COMPOSIO_BOX_TOOLKIT_VERSION },
  });
  return (await composio.tools.execute(slug, {
    userId: args.userId,
    connectedAccountId: args.connectedAccountId,
    version: COMPOSIO_BOX_TOOLKIT_VERSION,
    arguments: args.arguments,
  })) as { successful?: boolean; data?: unknown; error?: string };
}

export const listFolder = internalAction({
  args: {
    mode: v.union(v.literal("mock"), v.literal("live")),
    folderId: v.string(),
    limit: v.optional(v.number()),
    offset: v.optional(v.number()),
    marker: v.optional(v.string()),
    useMarker: v.optional(v.boolean()),
    composioUserId: v.optional(v.string()),
    connectedAccountId: v.optional(v.string()),
    simulate: v.optional(
      v.union(v.literal("expired_auth"), v.literal("denied_scope")),
    ),
  },
  returns: v.object({
    items: v.array(
      v.object({
        id: v.string(),
        name: v.string(),
        type: v.string(),
        size: v.optional(v.number()),
        modifiedAt: v.optional(v.string()),
      }),
    ),
    nextOffset: v.optional(v.number()),
    nextMarker: v.optional(v.string()),
    mode: v.union(v.literal("mock"), v.literal("live")),
    mockLabel: v.optional(v.string()),
    errorCode: v.optional(v.string()),
  }),
  handler: async (_ctx, args): Promise<ListResult> => {
    if (args.mode === "mock" || !composioConfigured()) {
      const source = createMockBoxFileSource({
        forceExpired: args.simulate === "expired_auth",
        forceDeniedScopes:
          args.simulate === "denied_scope" ? ["root_readwrite"] : undefined,
      });
      try {
        const page = await source.listFolder({
          folderId: args.folderId,
          limit: args.limit,
          offset: args.offset,
          marker: args.marker,
          useMarker: args.useMarker,
        });
        return {
          items: page.items,
          nextOffset: page.nextOffset,
          nextMarker: page.nextMarker,
          mode: "mock",
          mockLabel:
            page.mockLabel ??
            (composioConfigured()
              ? undefined
              : "MOCK — COMPOSIO_API_KEY unset; using local Box fixture"),
        };
      } catch (error) {
        if (error instanceof FileSourceError) {
          return {
            items: [],
            mode: "mock",
            mockLabel: "MOCK — error fixture",
            errorCode: error.code,
          };
        }
        throw error;
      }
    }

    if (!args.composioUserId || !args.connectedAccountId) {
      return {
        items: [],
        mode: "live",
        errorCode: "invalid_argument",
        mockLabel: undefined,
      };
    }

    try {
      const result = await executeComposioBox(BOX_TOOL_SLUGS.listItems, {
        userId: args.composioUserId,
        connectedAccountId: args.connectedAccountId,
        arguments: {
          folder_id: args.folderId,
          limit: args.limit ?? 50,
          offset: args.offset,
          marker: args.marker,
          usemarker: args.useMarker,
        },
      });
      if (result.error || result.successful === false) {
        const msg = String(result.error ?? "Box list failed");
        const expired = /expired|unauthorized|401/i.test(msg);
        const denied = /scope|403|forbidden/i.test(msg);
        return {
          items: [],
          mode: "live",
          errorCode: expired
            ? "expired_auth"
            : denied
              ? "denied_scope"
              : "provider_error",
        };
      }
      const data = result.data as {
        entries?: Array<{
          id: string;
          name: string;
          type: string;
          size?: number;
          modified_at?: string;
        }>;
        offset?: number;
        next_marker?: string;
      };
      const entries = data?.entries ?? [];
      return {
        items: entries.map((e) => ({
          id: e.id,
          name: e.name,
          type: e.type,
          size: e.size,
          modifiedAt: e.modified_at,
        })),
        nextOffset:
          typeof data?.offset === "number"
            ? data.offset + entries.length
            : undefined,
        nextMarker: data?.next_marker,
        mode: "live",
      };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      return {
        items: [],
        mode: "live",
        errorCode: /expired|401/i.test(msg) ? "expired_auth" : "provider_error",
      };
    }
  },
});

export const downloadFile = internalAction({
  args: {
    mode: v.union(v.literal("mock"), v.literal("live")),
    fileId: v.string(),
    composioUserId: v.optional(v.string()),
    connectedAccountId: v.optional(v.string()),
  },
  returns: v.object({
    ok: v.boolean(),
    mode: v.union(v.literal("mock"), v.literal("live")),
    mockLabel: v.optional(v.string()),
    fileId: v.optional(v.string()),
    name: v.optional(v.string()),
    contentType: v.optional(v.string()),
    contentBase64: v.optional(v.string()),
    errorCode: v.optional(v.string()),
    errorMessage: v.optional(v.string()),
  }),
  handler: async (_ctx, args): Promise<DownloadResult> => {
    if (args.mode === "mock" || !composioConfigured()) {
      const source = createMockBoxFileSource();
      try {
        const file = await source.download(args.fileId);
        return {
          ok: true,
          mode: "mock",
          mockLabel: file.mockLabel,
          fileId: file.fileId,
          name: file.name,
          contentType: file.contentType,
          contentBase64: Buffer.from(file.bytes).toString("base64"),
        };
      } catch (error) {
        if (error instanceof FileSourceError) {
          return {
            ok: false,
            mode: "mock",
            mockLabel: "MOCK — download error fixture",
            errorCode: error.code,
            errorMessage: error.message,
          };
        }
        throw error;
      }
    }

    if (!args.composioUserId || !args.connectedAccountId) {
      return {
        ok: false,
        mode: "live",
        errorCode: "invalid_argument",
        errorMessage: "Missing Composio user/connected account for live Box",
      };
    }

    try {
      const result = await executeComposioBox(BOX_TOOL_SLUGS.download, {
        userId: args.composioUserId,
        connectedAccountId: args.connectedAccountId,
        arguments: { file_id: args.fileId },
      });
      if (result.error || result.successful === false) {
        return {
          ok: false,
          mode: "live",
          errorCode: "provider_error",
          errorMessage: String(result.error ?? "download failed"),
        };
      }
      const data = result.data as {
        content?: string;
        name?: string;
        file_name?: string;
        mime_type?: string;
      };
      // Composio may return base64 content or a local path descriptor.
      const contentBase64 =
        typeof data?.content === "string"
          ? data.content
          : Buffer.from(JSON.stringify(data ?? {})).toString("base64");
      return {
        ok: true,
        mode: "live",
        fileId: args.fileId,
        name: data?.name ?? data?.file_name ?? args.fileId,
        contentType: data?.mime_type ?? "application/pdf",
        contentBase64,
      };
    } catch (error) {
      return {
        ok: false,
        mode: "live",
        errorCode: "provider_error",
        errorMessage: error instanceof Error ? error.message : String(error),
      };
    }
  },
});
