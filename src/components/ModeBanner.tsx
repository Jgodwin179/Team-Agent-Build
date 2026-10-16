"use client";

import { getChatSdkHealth } from "@/lib/channels/chat";
import { getEmailProviderHealth } from "@/lib/providers/email";
import { getSmsProviderHealth } from "@/lib/providers/sms";

export function ModeBanner({
  outboundDryRun,
  isTestOrganization,
}: {
  outboundDryRun?: boolean;
  isTestOrganization?: boolean;
}) {
  const email = getEmailProviderHealth();
  const chat = getChatSdkHealth();
  const sms = getSmsProviderHealth();

  return (
    <div className="border-b border-amber-300 bg-amber-50 px-4 py-2 text-sm text-amber-950">
      <p className="font-medium">Development / test mode</p>
      <ul className="mt-1 list-disc space-y-0.5 pl-5 text-amber-900/90">
        {isTestOrganization ? (
          <li>Active organization is a labeled test organization.</li>
        ) : null}
        {outboundDryRun !== false ? (
          <li>Outbound dry-run is ON — no live email/SMS/CRM writes.</li>
        ) : (
          <li className="font-semibold text-red-800">
            Outbound dry-run is OFF — live side effects may occur if providers
            are wired.
          </li>
        )}
        <li>Email: {email.message}</li>
        <li>SMS: {sms.message}</li>
        <li>Chat SDK: {chat.message}</li>
        <li>
          Schedules: disabled by default in development (org setting
          schedulesEnabled=false; no live outbound from schedule runners).
        </li>
      </ul>
    </div>
  );
}
