import { defineApp } from "convex/server";
import { v } from "convex/values";
import betterAuth from "@convex-dev/better-auth/convex.config";
import agent from "@convex-dev/agent/convex.config";
import workflow from "@convex-dev/workflow/convex.config";

const app = defineApp({
  env: {
    BETTER_AUTH_SECRET: v.string(),
    SITE_URL: v.string(),
    /** Set to "true" only when Convex AI Gateway credentials are configured. */
    USE_AI_GATEWAY: v.optional(v.union(v.literal("true"), v.literal("false"))),
    /** Composio managed connectors (Phase 3). Unset → labeled MOCK Box path. */
    COMPOSIO_API_KEY: v.optional(v.string()),
    /** GHL private integration / location token (Phase 3 reads). */
    GHL_API_KEY: v.optional(v.string()),
    GHL_LOCATION_ID: v.optional(v.string()),
    /** Force GHL mock even when keys exist. */
    GHL_FORCE_MOCK: v.optional(v.union(v.literal("true"), v.literal("false"))),
    /** Never enable in Phase 3 without explicit authorization. */
    ALLOW_LIVE_CRM_WRITES: v.optional(
      v.union(v.literal("true"), v.literal("false")),
    ),
  },
});

app.use(betterAuth);
app.use(agent);
app.use(workflow);

export default app;
