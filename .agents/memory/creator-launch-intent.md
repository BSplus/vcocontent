---
name: Creator launch preference
description: Original free Creator beta and the operator's later marketplace planning boundaries.
---

Zum Start bevorzugt der Nutzer ein einfaches, offenes Creator-Modell: Account anlegen, selbst Galerien veröffentlichen und die Services nutzen. Für Creator keine Videos, sondern begrenzte Bildzahlen und Upload-Speichermengen. Bezahlmodelle für mehr Galerien oder Space erst später erwägen.

**Why:** Der Nutzer möchte zunächst offen starten und anhand der Nutzung entscheiden, statt von Beginn an ein komplexes Bezahlmodell einzuführen.

**How to apply:** Die Public-Beta-Spezifikation konkretisiert den kostenlosen Fototarif. Die spätere Marketplace-Planung unten ersetzt die frühere Beschränkung auf das bloße Erwägen von Bezahlmodellen, aktiviert aber noch keine Monetarisierung. Keine Preise, Termine oder Einkommensversprechen erfinden.

## Marketplace planning model

The operator is planning hybrid Creator tiers: Free, Pro, Studio, Archive, separate from application roles. Each Creator manages their own storage allowance. All persistent Creator-managed assets, including JPEG, RAW, video, previews, variants and sidecars, count toward the same quota. RAW files require no special subscription or pricing model. No VCO-financed Creator assignments or VCO-funded RAW storage exceptions. Creators can delete assets, upgrade subscriptions or purchase additional storage. Creator commissions depend on subscription tier.

Buyers purchase credits to license assets. Creators receive earnings from sales and may use eligible earnings for services or request payouts through Stripe Connect. Buyer credits and Creator earnings must remain separate accounting balances.

**Why:** The operator explicitly supplied this business model for a read-only technical audit before an implementation specification.

**How to apply:** Use these as marketplace planning requirements, not approval to implement, configure payments, modify data, migrate or publish. Prices, allowances, commission rates, eligible services, accounting policies and licence terms still require decisions.

Generated downloads use a bounded, automatically cleaned platform-managed cache. Temporary cache objects must not unexpectedly consume Creator storage allowances; persistent Creator-managed variants and sidecars do count.

**Why:** The operator explicitly approved this distinction when consolidating the marketplace and metadata specifications.

**How to apply:** Keep temporary download caching separate from persistent Creator quotas and funding exceptions, with explicit platform capacity and cleanup limits. Never convert temporary cache storage into an unbounded persistent allowance.
