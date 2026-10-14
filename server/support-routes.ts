import type { Express } from "express";
import { supportSchema } from "../shared/support";
import { verificationConfigured } from "./beta-config";
import { sendBrandedEmail, EmailDeliveryError } from "./email-delivery";
import { supportEmail } from "./email-templates/support";
import { reserveSupport, confirmSupport, supportHash } from "./support-limits";

export function registerSupportRoutes(app: Express, dependencies = {
  configured: verificationConfigured, reserve: reserveSupport, confirm: confirmSupport,
  send: sendBrandedEmail, hash: supportHash,
}) {
  app.post("/api/support", async (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    // Also enforce on independently mounted routes; do not accept browser cross-site POSTs.
    if (req.get("origin") !== `${req.protocol}://${req.get("host")}` ||
      req.get("sec-fetch-site") === "cross-site")
      return res.status(403).json({ status: "rejected", error: "Use the support form on this website." });
    if (!req.is("application/json"))
      return res.status(415).json({ status: "validation", error: "Send a JSON support request." });
    const parsed = supportSchema.safeParse(req.body);
    if (!parsed.success) {
      const errors = Object.fromEntries(parsed.error.issues.map(issue => [issue.path[0] || "form", issue.message]));
      return res.status(400).json({ status: "validation", errors, error: "Please review the form." });
    }
    const input = parsed.data;
    if (input.website) return res.status(400).json({ status: "validation", error: "Leave the website field blank." });
    if (!dependencies.configured())
      return res.status(503).json({ status: "unavailable", error: "Support delivery is temporarily unavailable. Please try later." });
    let key: string;
    try {
      key = `support-${dependencies.hash(input.requestId)}`;
      const fingerprint = dependencies.hash(JSON.stringify([input.name, input.email, input.subject, input.message]));
      const reservation = await dependencies.reserve(req.ip || req.socket.remoteAddress || "unknown", input.requestId, fingerprint);
      if (reservation === "limited") {
        res.setHeader("Retry-After", "3600");
        return res.status(429).json({ status: "rate_limited", error: "Too many support requests. Please try later." });
      }
      if (reservation === "accepted") return res.json({ status: "accepted" });
      if (reservation === "uncertain") return res.status(409).json({ status: "uncertain" });
    } catch {
      return res.status(503).json({ status: "unavailable", error: "Support protection is temporarily unavailable. No email was sent." });
    }
    try {
      await dependencies.send("info@vco-esports.com", supportEmail(input), key, input.email);
    } catch (error) {
      if (error instanceof EmailDeliveryError && error.status === undefined)
        return res.status(503).json({ status: "unavailable", error: "Support delivery is temporarily unavailable. No email was sent." });
      // Only a definite provider refusal is a known rejection. Never expose provider bodies.
      const rejected = error instanceof EmailDeliveryError && error.status !== undefined &&
        error.status >= 400 && error.status < 500 && error.status !== 408 && error.status !== 409;
      return res.status(rejected ? 502 : 504).json({ status: rejected ? "rejected" : "uncertain",
        error: rejected ? "The mail provider did not accept your request. Please try later."
          : "We could not confirm acceptance. Your email may have been sent. Please do not send it again without checking with VCO." });
    }
    // A bookkeeping failure after provider acceptance must not invite another send.
    await dependencies.confirm(input.requestId).catch(() => {});
    return res.json({ status: "accepted" });
  });
}
