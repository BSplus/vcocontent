import { escapeHtml, renderEmailLayout } from "./layout";
import type { SupportInput } from "../../shared/support";

export function supportEmail(input: SupportInput) {
  return {
    subject: `VCO Support: ${input.subject}`,
    text: `Support enquiry\n\nName: ${input.name}\nEmail: ${input.email}\nSubject: ${input.subject}\n\n${input.message}`,
    html: renderEmailLayout({
      preheader: "A visitor has submitted a VCO support enquiry.",
      content: `<tr><td class="email-gutter" style="padding:28px 44px;color:#ACB6C0">
        <h1 style="margin:0 0 18px;color:#ffffff;font-size:29px;line-height:32px">Support enquiry</h1>
        <p>Name: ${escapeHtml(input.name)}<br>Email: ${escapeHtml(input.email)}<br>Subject: ${escapeHtml(input.subject)}</p>
        <p style="white-space:pre-wrap;overflow-wrap:anywhere">${escapeHtml(input.message)}</p></td></tr>`,
    }),
  };
}
