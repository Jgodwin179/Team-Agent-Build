import type { ProviderHealth, SmsProvider, SmsSendResult } from "./types";

/** Simple opt-out store for local MOCK/dry-run (not durable across deploys). */
const localOptOuts = new Set<string>();

export function suppressSmsNumber(e164: string) {
  localOptOuts.add(normalizePhone(e164));
}

export function isSmsSuppressed(e164: string): boolean {
  return localOptOuts.has(normalizePhone(e164));
}

function normalizePhone(value: string): string {
  return value.replace(/[^\d+]/g, "");
}

class MockSmsProvider implements SmsProvider {
  readonly name = "twilio";
  readonly mode = "mock" as const;

  async send(input: {
    to: string;
    body: string;
    idempotencyKey?: string;
  }): Promise<SmsSendResult> {
    if (isSmsSuppressed(input.to)) {
      return {
        externalId: `mock-sms-suppressed-${Date.now()}`,
        status: "suppressed",
      };
    }
    console.info("[MOCK SmsProvider] would send SMS", {
      to: input.to,
      bodyPreview: input.body.slice(0, 120),
    });
    return {
      externalId: `mock-sms-${input.idempotencyKey ?? Date.now()}`,
      status: "mock",
    };
  }
}

class DryRunSmsProvider implements SmsProvider {
  readonly name = "twilio";
  readonly mode = "dry-run" as const;

  async send(input: {
    to: string;
    body: string;
    idempotencyKey?: string;
  }): Promise<SmsSendResult> {
    if (isSmsSuppressed(input.to)) {
      return {
        externalId: `dry-run-sms-suppressed-${Date.now()}`,
        status: "suppressed",
      };
    }
    console.info("[DRY-RUN SmsProvider] blocked live SMS", {
      to: input.to,
    });
    return {
      externalId: `dry-run-sms-${input.idempotencyKey ?? Date.now()}`,
      status: "dry-run",
    };
  }
}

export function getSmsProvider(): SmsProvider {
  const sid = process.env.TWILIO_ACCOUNT_SID;
  const token = process.env.TWILIO_AUTH_TOKEN;
  const allowLive = process.env.ALLOW_LIVE_OUTBOUND === "true";
  if (!sid || !token) {
    return new MockSmsProvider();
  }
  if (!allowLive) {
    return new DryRunSmsProvider();
  }
  // Live Twilio sends go through Chat SDK adapter postMessage in Phase 4+;
  // refuse to pretend a raw SDK path is wired without Chat instance.
  return new DryRunSmsProvider();
}

export function getSmsProviderHealth(): ProviderHealth {
  const configured = Boolean(
    process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN,
  );
  const allowLive = process.env.ALLOW_LIVE_OUTBOUND === "true";
  if (!configured) {
    return {
      provider: "twilio-sms",
      mode: "mock",
      configured: false,
      message: "MOCK — Twilio credentials missing; no live SMS will be sent.",
    };
  }
  if (!allowLive) {
    return {
      provider: "twilio-sms",
      mode: "dry-run",
      configured: true,
      message:
        "DRY-RUN — Twilio credentials present but ALLOW_LIVE_OUTBOUND is not true.",
    };
  }
  return {
    provider: "twilio-sms",
    mode: "dry-run",
    configured: true,
    message:
      "DRY-RUN — live SMS must use Chat SDK Twilio adapter with explicit authorization.",
  };
}
