import { and, or, sql, type SQLWrapper } from "drizzle-orm";
import { eventImagePolicy } from "./event-image-policy";

/** Shared by thumbnail eligibility and its partial index; never indexes Base64. */
export function boundedGalleryThumbnailSql(thumbnail: SQLWrapper) {
  const inlineLimit = sql.raw(String(Math.ceil(eventImagePolicy.bytes * 4 / 3) + 100));
  return or(sql`${thumbnail} ~ '^/api/media/files/thumb-[0-9a-f-]{36}\\.webp$'`,
    and(sql`${thumbnail} ~ '^data:image/(jpeg|png|gif|webp);base64,[A-Za-z0-9+/]+={0,2}$'`,
      sql`length(${thumbnail}) <= ${inlineLimit}`))!;
}
