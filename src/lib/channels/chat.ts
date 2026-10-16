/**
 * Chat SDK wiring. Redis state is required for production;
 * memory state is acceptable for local mocks only — never claim live.
 *
 * Packages pinned: chat@4.42.0, @chat-adapter/state-redis@4.42.0,
 * @chat-adapter/twilio@4.42.0, @chat-adapter/state-memory@4.42.0
 *
 * Chat SDK is transport only — Convex owns durable runs.
 */

import type { ProviderHealth } from "../providers/types";

export type ChatSdkMode = "mock" | "dry-run" | "live-ready";

export function getChatSdkMode(): ChatSdkMode {
  const redisUrl = process.env.REDIS_URL;
  const twilioSid = process.env.TWILIO_ACCOUNT_SID;
  const twilioToken = process.env.TWILIO_AUTH_TOKEN;
  const allowLive = process.env.ALLOW_LIVE_OUTBOUND === "true";

  if (!twilioSid || !twilioToken || !redisUrl) {
    // Missing Twilio and/or Redis → labeled MOCK (memory state only).
    return "mock";
  }
  if (!allowLive) {
    return "dry-run";
  }
  return "live-ready";
}

export function getChatSdkHealth(): ProviderHealth {
  const mode = getChatSdkMode();
  if (mode === "mock") {
    return {
      provider: "chat-sdk",
      mode: "mock",
      configured: false,
      message:
        "MOCK — Chat SDK uses @chat-adapter/state-memory locally. Missing REDIS_URL and/or Twilio credentials for production state.",
    };
  }
  if (mode === "dry-run") {
    return {
      provider: "chat-sdk",
      mode: "dry-run",
      configured: true,
      message:
        "DRY-RUN — Redis + Twilio configured; outbound posts blocked unless ALLOW_LIVE_OUTBOUND=true. Convex owns runs.",
    };
  }
  return {
    provider: "chat-sdk",
    mode: "live",
    configured: true,
    message:
      "LIVE-READY — Redis state + Twilio adapter mounted. Chat SDK is transport only; Convex owns durable runs.",
  };
}
