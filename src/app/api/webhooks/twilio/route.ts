import { NextResponse } from "next/server";
import { validateTwilioWebhook } from "@/lib/webhooks/signatures";
import { getChatBot } from "@/lib/channels/bot";
import { getChatSdkMode } from "@/lib/channels/chat";

/**
 * Twilio Messaging webhook.
 * Validates signature, acknowledges promptly via Chat SDK adapter when live-ready.
 * Durable processing belongs in Convex (not in this transport handler).
 */
export async function POST(request: Request): Promise<Response> {
  const mode = getChatSdkMode();
  if (mode === "mock" && !process.env.TWILIO_AUTH_TOKEN) {
    return NextResponse.json(
      {
        ok: false,
        mode: "mock",
        error:
          "MOCK — Twilio not configured. Set TWILIO_ACCOUNT_SID/AUTH_TOKEN for signature-validated webhooks.",
      },
      { status: 503 },
    );
  }

  // Clone before verification so Chat SDK can re-read the body.
  const forVerify = request.clone();
  const validation = await validateTwilioWebhook(forVerify);
  if (!validation.ok) {
    return NextResponse.json(
      { ok: false, error: validation.error },
      { status: validation.status },
    );
  }

  const bot = getChatBot();
  if ("twilio" in bot.webhooks && typeof bot.webhooks.twilio === "function") {
    try {
      // Adapter re-verifies signature and returns TwiML/ack.
      return await bot.webhooks.twilio(request);
    } catch (error) {
      console.error("[twilio webhook] Chat SDK handle failed", error);
      // Still ack after our own signature validation so Twilio does not storm.
      return new Response(
        `<?xml version="1.0" encoding="UTF-8"?><Response></Response>`,
        {
          status: 200,
          headers: { "Content-Type": "text/xml" },
        },
      );
    }
  }

  return new Response(
    `<?xml version="1.0" encoding="UTF-8"?><Response></Response>`,
    {
      status: 200,
      headers: { "Content-Type": "text/xml" },
    },
  );
}
