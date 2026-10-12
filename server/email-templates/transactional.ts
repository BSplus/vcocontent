import { escapeHtml, renderEmailLayout } from "./layout";

export type TransactionalEmailKind =
  | "welcome"
  | "creator-welcome"
  | "gallery-published"
  | "password-reset"
  | "password-changed"
  | "processing-failure";

export interface TransactionalEmailData {
  galleryTitle?: string;
  galleryId?: number;
  maxGalleries?: number;
  maxPhotos?: number;
  storageMb?: number;
  resetUrl?: string;
  expiryMinutes?: number;
}

interface EmailCopy {
  subject: string;
  headline: string;
  intro?: string;
  paragraphs: string[];
  cta?: string;
  path?: string;
  notice?: string[];
}

function trustedOrigin(siteUrl: string): string {
  let site: URL;
  try {
    site = new URL(siteUrl);
  } catch {
    throw new TypeError("Invalid VCO site URL");
  }
  if (
    site.protocol !== "https:" ||
    !site.hostname ||
    site.username ||
    site.password ||
    site.pathname !== "/" ||
    site.search ||
    site.hash
  ) {
    throw new TypeError("VCO site URL must be a trusted HTTPS root");
  }
  return site.origin;
}

function validateResetUrl(resetUrl: string | undefined, origin: string): string {
  if (!resetUrl) throw new TypeError("A valid password reset URL is required");
  let reset: URL;
  try {
    reset = new URL(resetUrl);
  } catch {
    throw new TypeError("Invalid password reset URL");
  }
  if (
    reset.protocol !== "https:" ||
    reset.origin !== origin ||
    reset.username ||
    reset.password
  ) {
    throw new TypeError("Password reset URL must use the trusted HTTPS origin");
  }
  return reset.href;
}

function button(href: string, label: string): string {
  const safeHref = escapeHtml(href);
  return `<table role="presentation" border="0" cellspacing="0" cellpadding="0" style="border-collapse:collapse; margin:0 0 18px;">
  <tr><td align="center" bgcolor="#0099ed" style="background-color:#0099ed;">
    <!--[if mso]>
    <v:roundrect xmlns:v="urn:schemas-microsoft-com:vml" xmlns:w="urn:schemas-microsoft-com:office:word" href="${safeHref}" style="height:45px;v-text-anchor:middle;width:220px;" arcsize="0%" strokecolor="#0099ed" fillcolor="#0099ed">
      <w:anchorlock/>
      <center style="color:#111820;font-family:Arial,sans-serif;font-size:13px;font-weight:bold;letter-spacing:1px;">${label}</center>
    </v:roundrect>
    <![endif]-->
    <!--[if !mso]><!-->
    <a href="${safeHref}" target="_blank" style="display:inline-block; min-width:206px; padding:13px 20px; border:1px solid #0099ed; background-color:#0099ed; color:#101820; font-family:'IBM Plex Sans Condensed','Arial Narrow',Arial,sans-serif; font-size:13px; font-weight:700; letter-spacing:1.2px; line-height:17px; text-align:center; text-decoration:none;">${label}</a>
    <!--<![endif]-->
  </td></tr>
</table>
<p style="margin:0 0 6px; color:#7d8995; font-family:'IBM Plex Sans Condensed','Arial Narrow',Arial,sans-serif; font-size:12px; line-height:18px;">If the button does not work, copy and paste this link into your browser:</p>
<p style="margin:0 0 18px; overflow-wrap:anywhere; word-break:break-all; color:#48b7f4; font-family:Arial,sans-serif; font-size:12px; line-height:19px;"><a href="${safeHref}" target="_blank" style="color:#48b7f4; text-decoration:underline; overflow-wrap:anywhere; word-break:break-all;">${safeHref}</a></p>`;
}

function copyFor(
  kind: TransactionalEmailKind,
  data: TransactionalEmailData,
  origin: string,
): { copy: EmailCopy; href?: string } {
  switch (kind) {
    case "welcome":
      return {
        copy: {
          subject: "Welcome to VCO Content Database",
          headline: "WELCOME TO THE GRID.",
          paragraphs: [
            "Your account is ready.",
            "Welcome to the VCO Content Database – your home for motorsport photography, racing moments and creative content.",
            "Explore events, discover galleries, save your favourite shots and download content from the VCO community.",
          ],
          cta: "EXPLORE THE DATABASE",
          path: "/",
        },
        href: `${origin}/`,
      };
    case "creator-welcome": {
      const limits: string[] = [];
      if (data.maxGalleries !== undefined) limits.push(`Up to ${data.maxGalleries} galleries`);
      if (data.maxPhotos !== undefined) limits.push(`Up to ${data.maxPhotos.toLocaleString("en-GB")} photos`);
      if (data.storageMb !== undefined) limits.push(`${data.storageMb} MB of storage`);
      return {
        copy: {
          subject: "Welcome to VCO Creator Studio",
          headline: "YOUR WORK. YOUR STAGE.",
          paragraphs: [
            "Your VCO Creator Studio is ready.",
            "Create your first gallery, upload your best motorsport shots and let VCO's AI tools help organise your content.",
            "Your photography deserves to be seen.",
          ],
          cta: "OPEN CREATOR STUDIO",
          path: "/creator/dashboard",
          notice: limits.length
            ? ["Your Creator Free account includes:", ...limits, "AI-assisted tagging and captions."]
            : undefined,
        },
        href: `${origin}/creator/dashboard`,
      };
    }
    case "gallery-published": {
      if (!Number.isSafeInteger(data.galleryId) || (data.galleryId ?? 0) < 1) {
        throw new TypeError("A valid gallery ID is required");
      }
      if (typeof data.galleryTitle !== "string") {
        throw new TypeError("A gallery title is required");
      }
      return {
        copy: {
          subject: "Your gallery is live | VCO",
          headline: "YOU'RE LIVE.",
          paragraphs: [
            `Your gallery "${data.galleryTitle}" is now live on the VCO Content Database.`,
            "Your photography is ready for the community to discover.",
            "Share your gallery and let the racing world see your work.",
          ],
          cta: "VIEW YOUR GALLERY",
          path: `/events/${data.galleryId}`,
          notice: ["You can update your gallery information and manage your photos at any time in Creator Studio."],
        },
        href: `${origin}/events/${data.galleryId}`,
      };
    }
    case "password-reset": {
      if (!Number.isSafeInteger(data.expiryMinutes) || (data.expiryMinutes ?? 0) < 1) {
        throw new TypeError("A valid password reset expiry is required");
      }
      const href = validateResetUrl(data.resetUrl, origin);
      const duration = data.expiryMinutes === 1 ? "1 minute" : `${data.expiryMinutes} minutes`;
      return {
        copy: {
          subject: "Reset your password | VCO",
          headline: "BACK IN THE RACE.",
          paragraphs: [
            "Need a fresh start?",
            "We received a request to reset the password for your VCO account.",
            "Use the button below to choose a new password.",
          ],
          cta: "RESET PASSWORD",
          notice: [
            `This link expires after ${duration}.`,
            "If you did not request a password reset, you can safely ignore this email. Your password will remain unchanged.",
          ],
        },
        href,
      };
    }
    case "password-changed":
      return {
        copy: {
          subject: "Your password has changed | VCO",
          headline: "PASSWORD UPDATED.",
          paragraphs: [
            "Your VCO account password has been successfully changed.",
            "If you made this change, no further action is required.",
            "If this wasn't you, please contact VCO support immediately.",
          ],
          cta: "OPEN ACCOUNT",
          path: "/account",
        },
        href: `${origin}/account`,
      };
    case "processing-failure":
      return {
        copy: {
          subject: "Action needed for your VCO upload",
          headline: "SOMETHING NEEDS YOUR ATTENTION.",
          paragraphs: [
            "We couldn't complete processing for some of your uploaded content.",
            "Open Creator Studio to review the affected items and try again where appropriate.",
          ],
          cta: "REVIEW UPLOAD",
          path: "/creator/dashboard",
          notice: ["If the issue continues, please contact VCO support."],
        },
        href: `${origin}/creator/dashboard`,
      };
  }
}

export function transactionalEmail(
  siteUrl: string,
  kind: TransactionalEmailKind,
  data: TransactionalEmailData = {},
): { subject: string; html: string; text: string } {
  const origin = trustedOrigin(siteUrl);
  const { copy, href } = copyFor(kind, data, origin);
  const headline = escapeHtml(copy.headline);
  const paragraphs = copy.paragraphs
    .map((paragraph) => `<p class="email-mobile-copy" style="margin:0 0 12px; overflow-wrap:anywhere; word-break:break-word; color:#aeb9c3; font-family:'IBM Plex Sans Condensed','Arial Narrow',Arial,sans-serif; font-size:16px; line-height:25px;">${escapeHtml(paragraph)}</p>`)
    .join("\n");
  const cta = copy.cta && href ? button(href, copy.cta) : "";
  const notices = copy.notice?.length
    ? `<table role="presentation" width="100%" border="0" cellspacing="0" cellpadding="0" style="width:100%; border-collapse:collapse; border-left:2px solid #0099ed; margin-top:3px;"><tr><td style="padding:1px 0 1px 15px; color:#8f9ba7; font-family:'IBM Plex Sans Condensed','Arial Narrow',Arial,sans-serif; font-size:13px; line-height:21px;">${copy.notice.map(escapeHtml).join("<br>")}</td></tr></table>`
    : "";
  const content = `<tr><td class="email-gutter" style="padding:29px 44px 29px;">
  <h1 class="email-headline" style="margin:0 0 15px; color:#e6e9eb; font-family:'Big Shoulders Display','Arial Narrow',Arial,sans-serif; font-size:35px; font-weight:800; letter-spacing:-0.3px; line-height:38px; text-transform:uppercase;">${headline}</h1>
  ${paragraphs}
  ${cta}
  ${notices}
</td></tr>`;
  const html = renderEmailLayout({
    preheader: copy.paragraphs[0],
    content,
  });
  const textParts = [
    copy.headline,
    "",
    ...copy.paragraphs,
    ...(copy.cta && href ? ["", `${copy.cta}: ${href}`, "", `If the button does not work, copy and paste this link into your browser:`, href] : []),
    ...(copy.notice?.length ? ["", ...copy.notice] : []),
    "",
    "© Virtual Competition Organisation (VCO) GmbH",
  ];
  return { subject: copy.subject, html, text: textParts.join("\n") };
}
