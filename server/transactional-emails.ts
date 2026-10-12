import { and, eq, sql } from "drizzle-orm";
import { db } from "./db";
import { events, transactionalEmails, users } from "@shared/schema";
import { communityLimitsFor, publicEventPredicate } from "./beta-policy";
import { verificationConfigured } from "./beta-config";
import { publicSiteUrl } from "./seo";
import { EmailDeliveryError, sendBrandedEmail } from "./email-delivery";
import { transactionalEmail } from "./email-templates/transactional";

export type ActiveEmailKind = "welcome" | "creator-welcome" | "gallery-published";

/** Call inside the existing successful-event transaction. A savepoint prevents
 * outbox/schema faults from undoing the user's account/gallery change. */
export async function enqueueTransactionalEmail(tx: any, kind: ActiveEmailKind, userId: number, galleryId?: number) {
  await tx.execute(sql`savepoint email_enqueue`);
  try {
    await tx.insert(transactionalEmails).values({
      key: `${kind}:${kind === "gallery-published" ? galleryId : userId}`,
      kind, userId, galleryId: galleryId ?? null,
    }).onConflictDoNothing();
    await tx.execute(sql`release savepoint email_enqueue`);
  } catch {
    await tx.execute(sql`rollback to savepoint email_enqueue`);
    await tx.execute(sql`release savepoint email_enqueue`);
    console.error("[email] Confirmed event could not be queued", kind);
  }
}

let running = false;
let interval: ReturnType<typeof setInterval> | undefined;

/** Bounded in-process drain, with cross-instance row leases and persistent
 * event keys. Provider retries reuse the same Resend idempotency key. */
export async function drainTransactionalEmails() {
  if (running || !verificationConfigured()) return;
  const siteUrl = publicSiteUrl();
  if (!siteUrl) return;
  running = true;
  try {
    // Do not retry outside Resend's idempotency window (24h).
    await db.execute(sql`update transactional_emails set status='failed'
      where status in ('pending','sending') and (attempts>=4 or created_at<now()-interval '23 hours')
      and next_attempt_at<=now()`);
    for (let i = 0; i < 5; i++) {
      const claimed = await db.execute(sql`update transactional_emails set status='sending',
        attempts=attempts+1, next_attempt_at=now()+interval '5 minutes'
        where key=(select key from transactional_emails
          where status in ('pending','sending') and next_attempt_at<=now()
          and attempts<4 and created_at>=now()-interval '23 hours'
          order by created_at for update skip locked limit 1)
        returning key,kind,user_id,gallery_id,attempts,content,recipient`);
      const row = claimed.rows[0];
      if (!row) break;
      const key = String(row.key), kind = String(row.kind) as ActiveEmailKind, attempt = Number(row.attempts);
      const predicate = and(eq(transactionalEmails.key, key), eq(transactionalEmails.attempts, attempt),
        eq(transactionalEmails.status, "sending"));
      try {
        const [user] = await db.select().from(users).where(eq(users.id, Number(row.user_id)));
        let eligible = !!user?.emailVerifiedAt && !user.suspended &&
          (!row.recipient || row.recipient === user.email);
        let title: string | undefined;
        const galleryId = row.gallery_id == null ? undefined : Number(row.gallery_id);
        if (kind === "creator-welcome") eligible &&= user.isCreator && user.creatorStatus === "approved";
        if (kind === "gallery-published") {
          const [gallery] = await db.select({ title: events.title }).from(events)
            .where(and(eq(events.id, galleryId!), eq(events.creatorId, user?.id ?? -1), publicEventPredicate()));
          eligible &&= !!gallery;
          title = gallery?.title;
        }
        if (!eligible || !["welcome", "creator-welcome", "gallery-published"].includes(kind)) {
          await db.update(transactionalEmails).set({status: "skipped"}).where(predicate);
        } else {
          const limits = user.isAdmin ? undefined : communityLimitsFor(user.quotaException);
          const template = row.content as ReturnType<typeof transactionalEmail> | null || transactionalEmail(siteUrl, kind, {
            galleryId, galleryTitle: title, maxGalleries: limits?.galleries, maxPhotos: limits?.photos,
            storageMb: limits ? limits.bytes / 1_000_000 : undefined,
          });
          if (!row.content) await db.update(transactionalEmails)
            .set({content: template, recipient: user.email}).where(predicate);
          await sendBrandedEmail(user.email, template, `vco-${key}`);
          await db.update(transactionalEmails).set({status: "accepted", acceptedAt: new Date(),
            content: null, recipient: null}).where(predicate);
          console.info("[email] Provider accepted", kind);
        }
      } catch (error) {
        const permanent = error instanceof EmailDeliveryError && error.status != null &&
          error.status >= 400 && error.status < 500 && ![408,429].includes(error.status);
        await db.update(transactionalEmails).set({
          status: permanent || attempt >= 4 ? "failed" : "pending",
          nextAttemptAt: new Date(Date.now() + 30000 * 4 ** (attempt - 1)),
        }).where(predicate);
        console.warn("[email] Delivery not accepted", kind);
      }
      // Stay below provider burst limits without a separate service.
      if (i < 4) await new Promise(resolve => setTimeout(resolve, 600));
    }
  } finally { running = false; }
}

export function startTransactionalEmailWorker() {
  if (interval) return;
  const tick = () => { void drainTransactionalEmails().catch(() =>
    console.error("[email] Delivery queue temporarily unavailable")); };
  interval = setInterval(tick, 30000);
  interval.unref();
  tick();
}
