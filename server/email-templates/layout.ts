/**
 * Shared, dependency-free HTML layout for VCO transactional email.
 * Keep markup table-based and styles inline for broad email-client support.
 */

export interface EmailLayoutOptions {
  preheader: string;
  content: string;
}

export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => {
    switch (character) {
      case "&":
        return "&amp;";
      case "<":
        return "&lt;";
      case ">":
        return "&gt;";
      case '"':
        return "&quot;";
      default:
        return "&#39;";
    }
  });
}

/**
 * Render the shared VCO email frame. `content` is trusted template markup;
 * caller-provided text and attributes must be escaped before interpolation.
 */
export function renderEmailLayout({ preheader, content }: EmailLayoutOptions): string {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="color-scheme" content="dark light">
  <meta name="supported-color-schemes" content="dark light">
  <title>VCO Content Database</title>
  <style>
    @media only screen and (max-width: 620px) {
      .email-shell { width: 100% !important; }
      .email-gutter { padding-left: 22px !important; padding-right: 22px !important; }
      .email-headline { font-size: 29px !important; line-height: 32px !important; }
      .email-mobile-copy { font-size: 17px !important; line-height: 26px !important; }
    }
  </style>
</head>
<body style="margin:0; padding:0; background-color:#111820; color:#ACB6C0; font-family:'IBM Plex Sans Condensed','Arial Narrow',Arial,sans-serif; -webkit-text-size-adjust:100%; -ms-text-size-adjust:100%;">
  <div style="display:none; max-height:0; overflow:hidden; opacity:0; color:transparent; mso-hide:all;">${escapeHtml(preheader)}&#8199;&#847;&zwnj;&#8199;&#847;&zwnj;&#8199;&#847;&zwnj;</div>
  <table role="presentation" width="100%" border="0" cellspacing="0" cellpadding="0" style="width:100%; border-collapse:collapse; background-color:#111820;">
    <tr>
      <td align="center" style="padding:34px 14px 40px;">
        <table role="presentation" class="email-shell" width="600" border="0" cellspacing="0" cellpadding="0" style="width:100%; max-width:600px; border-collapse:collapse; background-color:#171f29;">
          <tr>
            <td class="email-gutter" style="padding:29px 44px 25px; border-top:3px solid #0099ed; border-bottom:1px solid #34414e;">
              <table role="presentation" width="100%" border="0" cellspacing="0" cellpadding="0" style="border-collapse:collapse;">
                <tr>
                  <td valign="middle" width="130" style="width:130px; padding-right:18px;">
                    <img src="cid:vco-logo" width="112" alt="VCO" style="display:block; width:112px; max-width:100%; height:auto; border:0; outline:none; text-decoration:none;">
                  </td>
                  <td align="right" valign="middle" style="color:#82909d; font-family:'IBM Plex Sans Condensed','Arial Narrow',Arial,sans-serif; font-size:11px; font-weight:600; letter-spacing:2px; line-height:16px; text-transform:uppercase;">CONTENT DATABASE</td>
                </tr>
              </table>
            </td>
          </tr>
          ${content}
        </table>
        <table role="presentation" width="600" border="0" cellspacing="0" cellpadding="0" style="width:100%; max-width:600px; border-collapse:collapse;">
          <tr>
            <td align="center" style="padding:17px 18px 0; color:#82909d; font-family:'IBM Plex Sans Condensed','Arial Narrow',Arial,sans-serif; font-size:11px; line-height:17px;">© Virtual Competition Organisation (VCO) GmbH</td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}
