import { escapeHtml, renderEmailLayout } from "./layout";

const SUBJECT = "Verify your email | VCO Content Database";
const HEADLINE = "ONE CLICK.\nYOU’RE IN.";
const INTRO = "Welcome to the VCO Content Database.";
const BODY =
  "Verify your email address to activate your account and get started.";
const CTA = "VERIFY EMAIL";

function validatedVerificationHref(siteUrl: string, verificationUrl: string): string {
  let trustedOrigin: string;
  let verification: URL;

  try {
    const site = new URL(siteUrl);
    if (
      site.protocol !== "https:" ||
      !site.hostname ||
      site.username ||
      site.password
    ) {
      throw new Error();
    }
    trustedOrigin = site.origin;
    verification = new URL(verificationUrl);
  } catch {
    throw new TypeError("Invalid verification URL configuration");
  }

  if (
    verification.protocol !== "https:" ||
    verification.origin !== trustedOrigin ||
    verification.username ||
    verification.password ||
    verification.pathname !== "/auth" ||
    verification.search !== "" ||
    !/^#verify=[a-fA-F0-9]{64}$/.test(verification.hash)
  ) {
    throw new TypeError("Invalid verification URL configuration");
  }

  return verification.href;
}

export function verificationEmail(
  siteUrl: string,
  verificationUrl: string,
): { subject: string; html: string; text: string } {
  const href = validatedVerificationHref(siteUrl, verificationUrl);
  const escapedHref = escapeHtml(href);
  const content = `<tr>
  <td class="email-gutter" style="padding:31px 44px 29px;">
    <h1 class="email-headline" style="margin:0 0 17px; color:#e6e9eb; font-family:'Big Shoulders Display','Arial Narrow',Arial,sans-serif; font-size:48px; font-weight:800; letter-spacing:-0.5px; line-height:50px; text-transform:uppercase;">${escapeHtml(HEADLINE).replaceAll("\n", "<br>")}</h1>
    <p class="email-mobile-copy" style="margin:0 0 8px; color:#dbe1e6; font-family:'IBM Plex Sans Condensed','Arial Narrow',Arial,sans-serif; font-size:18px; font-weight:600; line-height:27px;">${escapeHtml(INTRO)}</p>
    <p class="email-mobile-copy" style="margin:0 0 19px; color:#aeb9c3; font-family:'IBM Plex Sans Condensed','Arial Narrow',Arial,sans-serif; font-size:16px; line-height:25px;">${escapeHtml(BODY)}</p>
    <table role="presentation" border="0" cellspacing="0" cellpadding="0" style="border-collapse:collapse; margin:0 0 19px;">
      <tr>
        <td align="center" bgcolor="#0099ed" style="background-color:#0099ed;">
          <!--[if mso]>
          <v:roundrect xmlns:v="urn:schemas-microsoft-com:vml" xmlns:w="urn:schemas-microsoft-com:office:word" href="${escapedHref}" style="height:45px;v-text-anchor:middle;width:208px;" arcsize="0%" strokecolor="#0099ed" fillcolor="#0099ed">
            <w:anchorlock/>
          <center style="color:#111820;font-family:Arial,sans-serif;font-size:13px;font-weight:bold;letter-spacing:1px;">${CTA}</center>
          </v:roundrect>
          <![endif]-->
          <!--[if !mso]><!-->
          <a href="${escapedHref}" target="_blank" style="display:inline-block; min-width:206px; padding:13px 20px; border:1px solid #0099ed; background-color:#0099ed; color:#101820; font-family:'IBM Plex Sans Condensed','Arial Narrow',Arial,sans-serif; font-size:13px; font-weight:700; letter-spacing:1.4px; line-height:17px; text-align:center; text-decoration:none;">${CTA}</a>
          <!--<![endif]-->
        </td>
      </tr>
    </table>
    <table role="presentation" width="100%" border="0" cellspacing="0" cellpadding="0" style="width:100%; border-collapse:collapse; border-left:2px solid #0099ed;">
      <tr>
        <td style="padding:1px 0 1px 15px; color:#8f9ba7; font-family:'IBM Plex Sans Condensed','Arial Narrow',Arial,sans-serif; font-size:13px; line-height:21px;">
          This verification link expires after 60 minutes and can only be used once.<br>
          If you did not request registration, you can ignore this email.
        </td>
      </tr>
    </table>
    <p style="margin:19px 0 6px; color:#aeb9c3; font-family:'IBM Plex Sans Condensed','Arial Narrow',Arial,sans-serif; font-size:13px; font-weight:600; line-height:19px;">Button not working?</p>
    <p style="margin:0 0 6px; color:#7d8995; font-family:'IBM Plex Sans Condensed','Arial Narrow',Arial,sans-serif; font-size:12px; line-height:18px;">Copy and paste this verification link into your browser:</p>
    <p style="margin:0; overflow-wrap:anywhere; word-break:break-all; color:#48b7f4; font-family:Arial,sans-serif; font-size:12px; line-height:19px;"><a href="${escapedHref}" target="_blank" style="color:#48b7f4; text-decoration:underline; overflow-wrap:anywhere; word-break:break-all;">${escapedHref}</a></p>
  </td>
</tr>`;

  const html = renderEmailLayout({
    preheader: "Confirm your email address to activate your VCO Content Database account.",
    content,
  });

  const text = [
    HEADLINE,
    "",
    INTRO,
    "",
    BODY,
    "",
    `${CTA}: ${href}`,
    "",
    "This verification link expires after 60 minutes and can only be used once.",
    "If you did not request registration, you can ignore this email.",
    "",
    "If the button does not work, copy and paste this verification link into your browser:",
    href,
    "",
    "© Virtual Competition Organisation (VC) GmbH",
  ].join("\n");

  return { subject: SUBJECT, html, text };
}
