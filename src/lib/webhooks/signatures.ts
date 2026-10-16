import { createHmac, timingSafeEqual } from "node:crypto";
import { verifyTwilioRequest } from "@chat-adapter/twilio/webhook";

/**
 * Validate Twilio webhook signatures using the adapter helper
 * (exact request URL + form body + X-Twilio-Signature).
 */
export async function validateTwilioWebhook(
  request: Request,
): Promise<{ ok: true } | { ok: false; status: number; error: string }> {
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  if (!authToken) {
    return {
      ok: false,
      status: 503,
      error: "MOCK/unconfigured — TWILIO_AUTH_TOKEN missing; rejecting webhook",
    };
  }

  try {
    await verifyTwilioRequest(request, {
      authToken,
      webhookUrl: process.env.TWILIO_WEBHOOK_URL ?? request.url,
    });
    return { ok: true };
  } catch (error) {
    return {
      ok: false,
      status: 403,
      error:
        error instanceof Error
          ? error.message
          : "Twilio signature verification failed",
    };
  }
}

/**
 * AgentMail webhook HMAC with shared secret.
 * When AGENTMAIL_WEBHOOK_SECRET is unset, reject unless local fixture header
 * `X-AgentMail-Mock: true` is present (never claim live verification).
 */
export function validateAgentMailWebhook(
  rawBody: string,
  headers: Headers,
): { ok: true } | { ok: false; status: number; error: string } {
  const secret = process.env.AGENTMAIL_WEBHOOK_SECRET;
  const mockHeader = headers.get("x-agentmail-mock");

  if (!secret) {
    if (mockHeader === "true") {
      return { ok: true };
    }
    return {
      ok: false,
      status: 503,
      error:
        "MOCK/unconfigured — AGENTMAIL_WEBHOOK_SECRET missing; set secret or send X-AgentMail-Mock: true for local fixtures only",
    };
  }

  const signature =
    headers.get("x-agentmail-signature") ??
    headers.get("x-webhook-signature") ??
    "";
  if (!signature) {
    return { ok: false, status: 403, error: "Missing AgentMail signature" };
  }

  const expected = createHmac("sha256", secret)
    .update(rawBody)
    .digest("hex");
  const provided = signature.replace(/^sha256=/, "");

  try {
    const a = Buffer.from(expected, "utf8");
    const b = Buffer.from(provided, "utf8");
    if (a.length !== b.length || !timingSafeEqual(a, b)) {
      return { ok: false, status: 403, error: "Invalid AgentMail signature" };
    }
  } catch {
    return { ok: false, status: 403, error: "Invalid AgentMail signature" };
  }

  return { ok: true };
}
