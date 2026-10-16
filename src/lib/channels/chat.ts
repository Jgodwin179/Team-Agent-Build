/**
 * Chat SDK wiring (Phase 4). Redis state is required for production;
 * memory state is acceptable for local mocks only.
 *
 * Packages pinned: chat@4.42.0, @chat-adapter/state-redis@4.42.0,
 * @chat-adapter/twilio@4.42.0, @chat-adapter/state-memory@4.42.0
 */

import type { ProviderHealth } from "../providers/types";

export function getChatSdkHealth(): ProviderHealth {
  const redisUrl = process.env.REDIS_URL;
  const twilioSid = process.env.TWILIO_ACCOUNT_SID;
  const twilioToken = process.env.TWILIO_AUTH_TOKEN;

  if (!redisUrl || !twilioSid || !twilioToken) {
    return {
      provider: "chat-sdk",
      mode: "mock",
      configured: false,
      message:
        "MOCK — Chat SDK not started. Missing REDIS_URL and/or Twilio credentials. Use @chat-adapter/state-memory only for local tests.",
    };
  }

  return {
    provider: "chat-sdk",
    mode: "dry-run",
    configured: true,
    message:
      "Configured but bot instance is not mounted until Phase 4. Redis owns Chat SDK operational state only.",
  };
}
