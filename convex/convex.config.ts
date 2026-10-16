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
  },
});

app.use(betterAuth);
app.use(agent);
app.use(workflow);

export default app;
