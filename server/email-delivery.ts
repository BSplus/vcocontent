import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { verificationConfigured } from "./beta-config";

export interface EmailContent { subject: string; html: string; text: string }
export class EmailDeliveryError extends Error {
  constructor(readonly status?: number) { super("Email provider did not accept the message."); }
}

let logoContent: Promise<string> | undefined;
function emailLogo() {
  return logoContent ||= readFile(resolve(process.cwd(), "attached_assets/VCO_2021_reg_White_Trans.png"))
    .then(bytes => bytes.toString("base64"))
    .catch(() => {
      logoContent = undefined;
      throw new Error("Email brand asset is unavailable.");
    });
}

/** Acceptance is not inbox delivery. Never log bodies, recipients or action URLs. */
export async function sendBrandedEmail(to: string, template: EmailContent, idempotencyKey: string, replyTo?: string) {
  if (!verificationConfigured()) throw new EmailDeliveryError();
  if (replyTo !== undefined && (!/^[^\s<>\r\n]+@[^\s<>\r\n]+\.[^\s<>\r\n]+$/.test(replyTo) || replyTo.length > 254))
    throw new EmailDeliveryError();
  const logo = await emailLogo().catch(() => { throw new EmailDeliveryError(); });
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.RESEND_API_KEY}`, "Content-Type": "application/json",
      "Idempotency-Key": idempotencyKey,
    },
    body: JSON.stringify({
      from: process.env.RESEND_FROM, to: [to], ...template,
      ...(replyTo === undefined ? {} : { reply_to: replyTo }),
      attachments: [{ filename: "vco-logo.png", content: logo,
        content_type: "image/png", content_id: "vco-logo" }],
    }),
    signal: AbortSignal.timeout(10000),
  });
  if (!response.ok) {
    await response.body?.cancel();
    throw new EmailDeliveryError(response.status);
  }
  if (replyTo !== undefined) {
    const accepted = await response.json();
    if (!accepted || typeof accepted.id !== "string" || !accepted.id)
      throw new Error("Email acceptance could not be confirmed.");
  } else await response.body?.cancel();
}
