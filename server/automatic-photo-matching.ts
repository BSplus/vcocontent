import { sql, type SQL } from "drizzle-orm";
import { db } from "./db";
import { events } from "@shared/schema";

/**
 * Saved lists are confirmed references (previews live only in the browser).
 * Keep this predicate shared by admission, backlog discovery and status.
 * Aliases are internal constants, never request input.
 */
export function automaticEntrySql(eventAlias = "events", session: SQL = sql`null`, anySession = false) {
  const e = sql.raw(eventAlias);
  return sql`(
    exists(select 1 from event_entries ae where ae.event_id=${e}.id)
    or exists(select 1 from reference_documents ad
      where ad.kind='entry'
      and (ad.event_id=${e}.id and ad.owner_id is not distinct from ${e}.creator_id
        or ad.scope='season' and ad.series_id=${e}.series_id
          and ad.owner_id is not distinct from ${e}.creator_id
          and ad.season_year=coalesce(${e}.reference_season_year,extract(year from ${e}.date)::int))
      and (${anySession} or ad.session is null or ad.session=${session})
      and exists(select 1 from jsonb_array_elements(ad.rows) ar
        where (${anySession} or coalesce(ar->>'session','')='' or ar->>'session'=${session})
          and (ad.scope='event' or coalesce(ar->>'eventName','')=''
            or lower(trim(ar->>'eventName'))=lower(trim(${e}.title)))))
  )`;
}

export async function automaticPhotoMatching(eventId: number, executor: Pick<typeof db, "execute"> = db,
  session: string | null = null, anySession = false): Promise<boolean> {
  const result = await executor.execute(sql`select ${automaticEntrySql("events", sql`${session}`,anySession)} as eligible
    from ${events} where ${events.id}=${eventId}`);
  return result.rows[0]?.eligible === true;
}

/** Analysis status includes durable work that is awaiting bounded admission. */
export function automaticAnalysisStatusSql(eventAlias = "events", mediaAlias = "media_items", jobAlias = "media_analysis_jobs") {
  const e=sql.raw(eventAlias), m=sql.raw(mediaAlias), j=sql.raw(jobAlias);
  return sql<string>`case
    when ${m}.type='image' and not ${m}.identification_manual
      and ${automaticEntrySql(eventAlias,sql`${m}.recognition_session`)}
      and coalesce(${j}.status,'not_requested')<>'running'
      and (${j}.media_id is null or not ${j}.photo_workflow
        or ${e}.reference_revision<>${j}.reference_revision or ${j}.status='waiting') then 'queued'
    when ${j}.status='completed' and ${j}.recognition is not null and not ${j}.photo_workflow
      and coalesce(${e}.reference_revision,0)>${j}.reference_revision then 'queued'
    else coalesce(${j}.status,'not_requested') end`;
}
