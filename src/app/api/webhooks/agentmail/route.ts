import { NextResponse } from "next/server";
import { fetchMutation } from "convex/nextjs";
import { api } from "../../../../../convex/_generated/api";
import { validateAgentMailWebhook } from "@/lib/webhooks/signatures";

/**
 * AgentMail inbound webhook.
 * Validates signature (or labeled MOCK header), then persists via Convex.
 * Returns 200 only after durable persistence succeeds (or duplicate).
 */
export async function POST(request: Request): Promise<Response> {
  const rawBody = await request.text();
  const validation = validateAgentMailWebhook(rawBody, request.headers);
  if (!validation.ok) {
    return NextResponse.json(
      { ok: false, error: validation.error },
      { status: validation.status },
    );
  }

  let payload: {
    organizationId?: string;
    providerEventId?: string;
    from?: string;
    subject?: string;
    text?: string;
    attachmentName?: string;
    attachmentContentBase64?: string;
    dealHint?: string;
  };
  try {
    payload = JSON.parse(rawBody) as typeof payload;
  } catch {
    return NextResponse.json(
      { ok: false, error: "Invalid JSON body" },
      { status: 400 },
    );
  }

  if (!payload.organizationId || !payload.providerEventId) {
    return NextResponse.json(
      {
        ok: false,
        error: "organizationId and providerEventId are required",
      },
      { status: 400 },
    );
  }

  try {
    const result = await fetchMutation(api.pov.ingestSellerEmail, {
      organizationId: payload.organizationId as never,
      providerEventId: payload.providerEventId,
      from: payload.from ?? "seller@example.test",
      subject: payload.subject ?? "(no subject)",
      text: payload.text ?? "",
      attachmentName: payload.attachmentName,
      attachmentContentBase64: payload.attachmentContentBase64,
      dealHint: payload.dealHint,
      viaWebhook: true,
      webhookSecret: process.env.AGENTMAIL_WEBHOOK_SECRET,
    });
    return NextResponse.json({ ok: true, ...result }, { status: 200 });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : "Persist failed",
      },
      { status: 500 },
    );
  }
}
