import { Chat } from "chat";
import { createTwilioAdapter } from "@chat-adapter/twilio";
import { createMemoryState } from "@chat-adapter/state-memory";
import { createRedisState } from "@chat-adapter/state-redis";
import { getChatSdkMode } from "./chat";

/**
 * Chat SDK bot instance (transport layer only).
 * Inbound SMS is acknowledged here; durable work is persisted in Convex.
 * Never claim live when Redis/Twilio are missing — memory state is MOCK-only.
 */
function buildBot() {
  const mode = getChatSdkMode();
  const redisUrl = process.env.REDIS_URL;
  const useRedis = Boolean(redisUrl) && mode !== "mock";

  const state = useRedis
    ? createRedisState({
        url: redisUrl,
        keyPrefix: "team-agent-platform",
      })
    : createMemoryState();

  const twilioConfigured = Boolean(
    process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN,
  );

  if (!twilioConfigured) {
    // Empty adapters are valid; webhook routes reject with labeled MOCK.
    return new Chat({
      userName: "team-agent-platform",
      adapters: {},
      state,
    });
  }

  const twilio = createTwilioAdapter({
    accountSid: process.env.TWILIO_ACCOUNT_SID,
    authToken: process.env.TWILIO_AUTH_TOKEN,
    phoneNumber: process.env.TWILIO_PHONE_NUMBER,
    messagingServiceSid: process.env.TWILIO_MESSAGING_SERVICE_SID,
    webhookUrl: process.env.TWILIO_WEBHOOK_URL,
  });

  const bot = new Chat({
    userName: "team-agent-platform",
    adapters: { twilio },
    state,
  });

  // Transport handlers — do not run durable agent loops here.
  bot.onDirectMessage(async (thread, message) => {
    const text = (message.text ?? "").trim().toUpperCase();
    const replyPrefix =
      mode === "live-ready" ? "[ACK]" : "[MOCK/DRY-RUN]";

    if (text === "STOP" || text === "UNSUBSCRIBE") {
      // Opt-out acknowledgement only — no deal content. Live post blocked
      // unless ALLOW_LIVE_OUTBOUND is enabled (Chat SDK may still accept).
      if (mode === "live-ready") {
        await thread.post(
          "Opt-out recorded. Reply START to resume staff alerts.",
        );
      } else {
        console.info(
          `${replyPrefix} Opt-out recorded for thread (no live SMS).`,
        );
      }
      return;
    }

    // Acknowledge transport only; Convex owns runs.
    if (mode === "live-ready") {
      await thread.post(
        "Message received. Continue in the Team Agent Platform app.",
      );
    } else {
      console.info(
        `${replyPrefix} Inbound SMS acknowledged; durable processing is Convex-owned.`,
        { textPreview: (message.text ?? "").slice(0, 80) },
      );
    }
  });

  return bot;
}

let cached: ReturnType<typeof buildBot> | null = null;

export function getChatBot() {
  if (!cached) {
    cached = buildBot();
  }
  return cached;
}

/** Reset cached bot (tests / env changes in the same process). */
export function resetChatBotForTests() {
  cached = null;
}
