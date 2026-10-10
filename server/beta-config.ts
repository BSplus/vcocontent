export function verificationConfigured() {
  if (!process.env.RESEND_API_KEY || !process.env.RESEND_FROM ||
    !/^[^<>\r\n]+@[^<>\r\n]+\.[^<>\r\n]+$/.test(process.env.RESEND_FROM)) return false;
  try {
    const url = new URL(process.env.PUBLIC_SITE_URL || "");
    return url.protocol==="https:" && !url.username && !url.password &&
      url.pathname==="/" && !url.search && !url.hash;
  } catch { return false; }
}
