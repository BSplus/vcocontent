-- PREPARED ONLY. Never executed against Production by Agent.
-- Use one verified Production connection and execute this WHOLE file in one session.
-- For psql use -v ON_ERROR_STOP=1. Never split across independent query calls.
-- Target proof: operator connection verification + neondb + schema/all-table fingerprints.
-- All gates below deliberately false/empty. No credentials belong in this file.
-- Rehearsal ends in ROLLBACK. A later COMMIT requires a separate operator decision.
BEGIN;
SET LOCAL search_path=pg_catalog,public;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='30s';
SET LOCAL idle_in_transaction_session_timeout='60s';
SELECT set_config('vco_cleanup.production_target_confirmed','false',true);
SELECT set_config('vco_cleanup.pitr_confirmed','false',true);
SELECT set_config('vco_cleanup.application_quiescent','false',true);
-- ISO 8601 with explicit UTC offset, e.g. ...Z or ...+02:00; no ambiguous local time.
SELECT set_config('vco_cleanup.recovery_timestamp','',true);

LOCK TABLE public."beta_rate_limits",public."community_favorites",public."community_likes",public."creator_event_associations",public."creator_follows",public."download_history",public."download_operations",public."email_verifications",public."event_entries",public."events",public."media_analysis_jobs",public."media_cleanup",public."media_items",public."media_reservations",public."nextcloud_files",public."nextcloud_jobs",public."nextcloud_sources",public."reference_documents",public."safety_results",public."safety_reviews",public."series",public."session",public."transactional_emails",public."users" IN SHARE ROW EXCLUSIVE MODE;
DO $cleanup$
DECLARE actual_n bigint; actual_digest text; affected bigint;
  recovery_point timestamptz; original_container jsonb;
BEGIN
  IF current_database()<>'neondb' THEN RAISE EXCEPTION 'Wrong database'; END IF;
  IF current_setting('vco_cleanup.production_target_confirmed')<>'true' OR
    current_setting('vco_cleanup.pitr_confirmed')<>'true' OR
    current_setting('vco_cleanup.application_quiescent')<>'true'
    THEN RAISE EXCEPTION 'Operator target/PITR/quiescence confirmations missing'; END IF;
  IF current_setting('vco_cleanup.recovery_timestamp') !~ '(Z|[+-][0-9]{2}:[0-9]{2})$'
    THEN RAISE EXCEPTION 'Record a pre-cleanup recovery timestamp with explicit UTC offset'; END IF;
  recovery_point := current_setting('vco_cleanup.recovery_timestamp')::timestamptz;
  IF recovery_point>=transaction_timestamp() OR recovery_point<transaction_timestamp()-interval '15 minutes'
    THEN RAISE EXCEPTION 'Choose a confirmed recovery point immediately before this transaction (within 15 minutes)'; END IF;
  RAISE NOTICE 'Recovery point UTC: %',recovery_point AT TIME ZONE 'UTC';
  IF (SELECT array_agg(table_name::text ORDER BY table_name) FROM information_schema.tables
    WHERE table_schema='public' AND table_type='BASE TABLE')
    IS DISTINCT FROM ARRAY['beta_rate_limits','community_favorites','community_likes','creator_event_associations','creator_follows','download_history','download_operations','email_verifications','event_entries','events','media_analysis_jobs','media_cleanup','media_items','media_reservations','nextcloud_files','nextcloud_jobs','nextcloud_sources','reference_documents','safety_results','safety_reviews','series','session','transactional_emails','users']::text[]
    THEN RAISE EXCEPTION 'Public table inventory changed'; END IF;
  IF (SELECT digest FROM (select encode(sha256(convert_to(coalesce(string_agg(v,',' order by v),''),'UTF8')),'hex') as digest from (
 select 'column:'||table_name||':'||column_name||':'||data_type||':'||is_nullable||':'||coalesce(column_default,'') as v
 from information_schema.columns where table_schema='public'
 union all select 'constraint:'||c.relname||':'||pg_get_constraintdef(x.oid)
 from pg_constraint x join pg_class c on c.oid=x.conrelid join pg_namespace n on n.oid=c.relnamespace where n.nspname='public'
 union all select 'trigger:'||c.relname||':'||pg_get_triggerdef(t.oid)
 from pg_trigger t join pg_class c on c.oid=t.tgrelid join pg_namespace n on n.oid=c.relnamespace
 where n.nspname='public' and not t.tgisinternal) definitions) snapshot)<>'e611361bab569d08b64584b357ef40ea8026a41288e052200c8d12c842d6c5d2'
    THEN RAISE EXCEPTION 'Schema/constraints/triggers changed'; END IF;
  IF EXISTS(SELECT 1 FROM pg_constraint fk JOIN pg_class parent ON parent.oid=fk.confrelid
    JOIN pg_namespace pn ON pn.oid=parent.relnamespace
    JOIN pg_class child ON child.oid=fk.conrelid JOIN pg_namespace cn ON cn.oid=child.relnamespace
    WHERE fk.contype='f' AND pn.nspname='public' AND parent.relname IN('events','media_items')
      AND cn.nspname<>'public')
    THEN RAISE EXCEPTION 'Unreviewed cross-schema dependency'; END IF;

  SELECT n,digest INTO actual_n,actual_digest FROM (select count(*)::int as n,
  encode(sha256(convert_to(coalesce(string_agg(h,',' order by h),''),'UTF8')),'hex') as digest
  from (select encode(sha256(convert_to(to_jsonb(r)::text,'UTF8')),'hex') h from "beta_rate_limits" r) hashes) snapshot;
  IF actual_n <> 8 OR actual_digest <> '4a0e7af25fabba33419b46c1b4970a116afb8103d3b7f491652e19a108ced342'
    THEN RAISE EXCEPTION 'Approved fingerprint mismatch: beta_rate_limits. Stop; renewed approval required.'; END IF;

  SELECT n,digest INTO actual_n,actual_digest FROM (select count(*)::int as n,
  encode(sha256(convert_to(coalesce(string_agg(h,',' order by h),''),'UTF8')),'hex') as digest
  from (select encode(sha256(convert_to(to_jsonb(r)::text,'UTF8')),'hex') h from "community_favorites" r) hashes) snapshot;
  IF actual_n <> 1 OR actual_digest <> '6384ee49ae49ebc1f1308cf08d0452afa547f190d1372fc653c4b2e0c4594a79'
    THEN RAISE EXCEPTION 'Approved fingerprint mismatch: community_favorites. Stop; renewed approval required.'; END IF;

  SELECT n,digest INTO actual_n,actual_digest FROM (select count(*)::int as n,
  encode(sha256(convert_to(coalesce(string_agg(h,',' order by h),''),'UTF8')),'hex') as digest
  from (select encode(sha256(convert_to(to_jsonb(r)::text,'UTF8')),'hex') h from "community_likes" r) hashes) snapshot;
  IF actual_n <> 2 OR actual_digest <> 'a2ff74c68b19eb7df6336a2d86afb3cd1122e52753fa2faa9c439bd6dc1ece99'
    THEN RAISE EXCEPTION 'Approved fingerprint mismatch: community_likes. Stop; renewed approval required.'; END IF;

  SELECT n,digest INTO actual_n,actual_digest FROM (select count(*)::int as n,
  encode(sha256(convert_to(coalesce(string_agg(h,',' order by h),''),'UTF8')),'hex') as digest
  from (select encode(sha256(convert_to(to_jsonb(r)::text,'UTF8')),'hex') h from "creator_event_associations" r) hashes) snapshot;
  IF actual_n <> 0 OR actual_digest <> 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'
    THEN RAISE EXCEPTION 'Approved fingerprint mismatch: creator_event_associations. Stop; renewed approval required.'; END IF;

  SELECT n,digest INTO actual_n,actual_digest FROM (select count(*)::int as n,
  encode(sha256(convert_to(coalesce(string_agg(h,',' order by h),''),'UTF8')),'hex') as digest
  from (select encode(sha256(convert_to(to_jsonb(r)::text,'UTF8')),'hex') h from "creator_follows" r) hashes) snapshot;
  IF actual_n <> 0 OR actual_digest <> 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'
    THEN RAISE EXCEPTION 'Approved fingerprint mismatch: creator_follows. Stop; renewed approval required.'; END IF;

  SELECT n,digest INTO actual_n,actual_digest FROM (select count(*)::int as n,
  encode(sha256(convert_to(coalesce(string_agg(h,',' order by h),''),'UTF8')),'hex') as digest
  from (select encode(sha256(convert_to(to_jsonb(r)::text,'UTF8')),'hex') h from "download_history" r) hashes) snapshot;
  IF actual_n <> 1 OR actual_digest <> '0c37c39ac2ce9c2b0e7558a1ea08db1f9a9504d7f8e3d38d44b0064ccae2ac23'
    THEN RAISE EXCEPTION 'Approved fingerprint mismatch: download_history. Stop; renewed approval required.'; END IF;

  SELECT n,digest INTO actual_n,actual_digest FROM (select count(*)::int as n,
  encode(sha256(convert_to(coalesce(string_agg(h,',' order by h),''),'UTF8')),'hex') as digest
  from (select encode(sha256(convert_to(to_jsonb(r)::text,'UTF8')),'hex') h from "download_operations" r) hashes) snapshot;
  IF actual_n <> 1 OR actual_digest <> 'dfac7c3f6bb781002ee49fd00bfdb08b3443b1a64c8c0700ae83cb95fbb96dd2'
    THEN RAISE EXCEPTION 'Approved fingerprint mismatch: download_operations. Stop; renewed approval required.'; END IF;

  SELECT n,digest INTO actual_n,actual_digest FROM (select count(*)::int as n,
  encode(sha256(convert_to(coalesce(string_agg(h,',' order by h),''),'UTF8')),'hex') as digest
  from (select encode(sha256(convert_to(to_jsonb(r)::text,'UTF8')),'hex') h from "email_verifications" r) hashes) snapshot;
  IF actual_n <> 2 OR actual_digest <> 'b020c7960be2ac67fb1a5b73473c44c68332353af2fc9f7580cfdc65aee56af0'
    THEN RAISE EXCEPTION 'Approved fingerprint mismatch: email_verifications. Stop; renewed approval required.'; END IF;

  SELECT n,digest INTO actual_n,actual_digest FROM (select count(*)::int as n,
  encode(sha256(convert_to(coalesce(string_agg(h,',' order by h),''),'UTF8')),'hex') as digest
  from (select encode(sha256(convert_to(to_jsonb(r)::text,'UTF8')),'hex') h from "event_entries" r) hashes) snapshot;
  IF actual_n <> 0 OR actual_digest <> 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'
    THEN RAISE EXCEPTION 'Approved fingerprint mismatch: event_entries. Stop; renewed approval required.'; END IF;

  SELECT n,digest INTO actual_n,actual_digest FROM (select count(*)::int as n,
  encode(sha256(convert_to(coalesce(string_agg(h,',' order by h),''),'UTF8')),'hex') as digest
  from (select encode(sha256(convert_to(to_jsonb(r)::text,'UTF8')),'hex') h from "events" r) hashes) snapshot;
  IF actual_n <> 4 OR actual_digest <> '98603464848744ab1079c7f099b580ba5c5b95baaedd2e3d5762bfe92f165afa'
    THEN RAISE EXCEPTION 'Approved fingerprint mismatch: events. Stop; renewed approval required.'; END IF;

  SELECT n,digest INTO actual_n,actual_digest FROM (select count(*)::int as n,
  encode(sha256(convert_to(coalesce(string_agg(h,',' order by h),''),'UTF8')),'hex') as digest
  from (select encode(sha256(convert_to(to_jsonb(r)::text,'UTF8')),'hex') h from "media_analysis_jobs" r) hashes) snapshot;
  IF actual_n <> 205 OR actual_digest <> 'd9014275c360cf43ef047d00dc1e812fec1f8fe8f6c3a18586d899454f94abfb'
    THEN RAISE EXCEPTION 'Approved fingerprint mismatch: media_analysis_jobs. Stop; renewed approval required.'; END IF;

  SELECT n,digest INTO actual_n,actual_digest FROM (select count(*)::int as n,
  encode(sha256(convert_to(coalesce(string_agg(h,',' order by h),''),'UTF8')),'hex') as digest
  from (select encode(sha256(convert_to(to_jsonb(r)::text,'UTF8')),'hex') h from "media_cleanup" r) hashes) snapshot;
  IF actual_n <> 0 OR actual_digest <> 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'
    THEN RAISE EXCEPTION 'Approved fingerprint mismatch: media_cleanup. Stop; renewed approval required.'; END IF;

  SELECT n,digest INTO actual_n,actual_digest FROM (select count(*)::int as n,
  encode(sha256(convert_to(coalesce(string_agg(h,',' order by h),''),'UTF8')),'hex') as digest
  from (select encode(sha256(convert_to(to_jsonb(r)::text,'UTF8')),'hex') h from "media_items" r) hashes) snapshot;
  IF actual_n <> 209 OR actual_digest <> 'c18aec345516bb28ba4db138cd104bb46aeabac72ce14fff5fd032526dff6f68'
    THEN RAISE EXCEPTION 'Approved fingerprint mismatch: media_items. Stop; renewed approval required.'; END IF;

  SELECT n,digest INTO actual_n,actual_digest FROM (select count(*)::int as n,
  encode(sha256(convert_to(coalesce(string_agg(h,',' order by h),''),'UTF8')),'hex') as digest
  from (select encode(sha256(convert_to(to_jsonb(r)::text,'UTF8')),'hex') h from "media_reservations" r) hashes) snapshot;
  IF actual_n <> 0 OR actual_digest <> 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'
    THEN RAISE EXCEPTION 'Approved fingerprint mismatch: media_reservations. Stop; renewed approval required.'; END IF;

  SELECT n,digest INTO actual_n,actual_digest FROM (select count(*)::int as n,
  encode(sha256(convert_to(coalesce(string_agg(h,',' order by h),''),'UTF8')),'hex') as digest
  from (select encode(sha256(convert_to(to_jsonb(r)::text,'UTF8')),'hex') h from "nextcloud_files" r) hashes) snapshot;
  IF actual_n <> 209 OR actual_digest <> 'f99352e8a147ea02de602aacef02b352af8f8f4231062e8c0747fcb4ba9d88d1'
    THEN RAISE EXCEPTION 'Approved fingerprint mismatch: nextcloud_files. Stop; renewed approval required.'; END IF;

  SELECT n,digest INTO actual_n,actual_digest FROM (select count(*)::int as n,
  encode(sha256(convert_to(coalesce(string_agg(h,',' order by h),''),'UTF8')),'hex') as digest
  from (select encode(sha256(convert_to(to_jsonb(r)::text,'UTF8')),'hex') h from "nextcloud_jobs" r) hashes) snapshot;
  IF actual_n <> 1 OR actual_digest <> 'a2b0f4ef5a6701a0fc68bded91af3657d17429fea8f05c21b5c8227bb9d8320a'
    THEN RAISE EXCEPTION 'Approved fingerprint mismatch: nextcloud_jobs. Stop; renewed approval required.'; END IF;

  SELECT n,digest INTO actual_n,actual_digest FROM (select count(*)::int as n,
  encode(sha256(convert_to(coalesce(string_agg(h,',' order by h),''),'UTF8')),'hex') as digest
  from (select encode(sha256(convert_to(to_jsonb(r)::text,'UTF8')),'hex') h from "nextcloud_sources" r) hashes) snapshot;
  IF actual_n <> 1 OR actual_digest <> 'f792a01205b810f26d131725c22864d7acf2557ed06a7b6c4ed987333a440e9e'
    THEN RAISE EXCEPTION 'Approved fingerprint mismatch: nextcloud_sources. Stop; renewed approval required.'; END IF;

  SELECT n,digest INTO actual_n,actual_digest FROM (select count(*)::int as n,
  encode(sha256(convert_to(coalesce(string_agg(h,',' order by h),''),'UTF8')),'hex') as digest
  from (select encode(sha256(convert_to(to_jsonb(r)::text,'UTF8')),'hex') h from "reference_documents" r) hashes) snapshot;
  IF actual_n <> 1 OR actual_digest <> '8cc24d8d725bf53475400db5f4d76a5bd9123013506c7a7d03faf5ab7ef37a8e'
    THEN RAISE EXCEPTION 'Approved fingerprint mismatch: reference_documents. Stop; renewed approval required.'; END IF;

  SELECT n,digest INTO actual_n,actual_digest FROM (select count(*)::int as n,
  encode(sha256(convert_to(coalesce(string_agg(h,',' order by h),''),'UTF8')),'hex') as digest
  from (select encode(sha256(convert_to(to_jsonb(r)::text,'UTF8')),'hex') h from "safety_results" r) hashes) snapshot;
  IF actual_n <> 5 OR actual_digest <> '699db7901d4330dd2218c5016879962f0f18fbfe1a818c95a13f9e36e904d1b2'
    THEN RAISE EXCEPTION 'Approved fingerprint mismatch: safety_results. Stop; renewed approval required.'; END IF;

  SELECT n,digest INTO actual_n,actual_digest FROM (select count(*)::int as n,
  encode(sha256(convert_to(coalesce(string_agg(h,',' order by h),''),'UTF8')),'hex') as digest
  from (select encode(sha256(convert_to(to_jsonb(r)::text,'UTF8')),'hex') h from "safety_reviews" r) hashes) snapshot;
  IF actual_n <> 0 OR actual_digest <> 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'
    THEN RAISE EXCEPTION 'Approved fingerprint mismatch: safety_reviews. Stop; renewed approval required.'; END IF;

  SELECT n,digest INTO actual_n,actual_digest FROM (select count(*)::int as n,
  encode(sha256(convert_to(coalesce(string_agg(h,',' order by h),''),'UTF8')),'hex') as digest
  from (select encode(sha256(convert_to(to_jsonb(r)::text,'UTF8')),'hex') h from "series" r) hashes) snapshot;
  IF actual_n <> 3 OR actual_digest <> '1ee4452d85d55882c5a483accb6b5e3d5af27ffa33dece6f38a20b20b3cfff6e'
    THEN RAISE EXCEPTION 'Approved fingerprint mismatch: series. Stop; renewed approval required.'; END IF;

  SELECT n,digest INTO actual_n,actual_digest FROM (select count(*)::int as n,
  encode(sha256(convert_to(coalesce(string_agg(h,',' order by h),''),'UTF8')),'hex') as digest
  from (select encode(sha256(convert_to(to_jsonb(r)::text,'UTF8')),'hex') h from "session" r) hashes) snapshot;
  IF actual_n <> 3 OR actual_digest <> 'f06ea7d22dab2190715d737882fac9bf103bd9a0a1dd869d9f6e300fa1c57504'
    THEN RAISE EXCEPTION 'Approved fingerprint mismatch: session. Stop; renewed approval required.'; END IF;

  SELECT n,digest INTO actual_n,actual_digest FROM (select count(*)::int as n,
  encode(sha256(convert_to(coalesce(string_agg(h,',' order by h),''),'UTF8')),'hex') as digest
  from (select encode(sha256(convert_to(to_jsonb(r)::text,'UTF8')),'hex') h from "transactional_emails" r) hashes) snapshot;
  IF actual_n <> 1 OR actual_digest <> '4c88e4f1308cb11783c3f0c5ef50298649c23d20ba6005fb430d14e0b0550bae'
    THEN RAISE EXCEPTION 'Approved fingerprint mismatch: transactional_emails. Stop; renewed approval required.'; END IF;

  SELECT n,digest INTO actual_n,actual_digest FROM (select count(*)::int as n,
  encode(sha256(convert_to(coalesce(string_agg(h,',' order by h),''),'UTF8')),'hex') as digest
  from (select encode(sha256(convert_to(to_jsonb(r)::text,'UTF8')),'hex') h from "users" r) hashes) snapshot;
  IF actual_n <> 37 OR actual_digest <> 'ab6d5b337713bf81d6656ac6e6f74e7b413008219e5c769ecb14981757de198c'
    THEN RAISE EXCEPTION 'Approved fingerprint mismatch: users. Stop; renewed approval required.'; END IF;
  IF EXISTS(SELECT 1 FROM reference_documents WHERE event_id IN(29,30,31)) OR
    EXISTS(SELECT 1 FROM nextcloud_sources WHERE event_id IN(29,30,31))
    THEN RAISE EXCEPTION 'Protected resource on deleted event'; END IF;
  IF (SELECT count(*) FROM reference_documents WHERE id=48 AND event_id=224)<>1 OR
    (SELECT count(*) FROM nextcloud_sources WHERE event_id=224)<>1
    THEN RAISE EXCEPTION 'Protected container resources missing'; END IF;
  SELECT to_jsonb(e)-ARRAY['visibility','admin_hidden','cover_image','custom_thumbnail']
    INTO original_container FROM events e WHERE id=224;

  DELETE FROM "media_analysis_jobs" WHERE media_id=ANY(ARRAY[170,171,172,173,592,593,594,595,596,597,598,599,600,601,602,603,604,605,606,607,608,609,610,611,612,613,614,615,616,617,618,619,620,621,622,623,624,625,626,627,628,629,630,631,632,633,634,635,636,637,638,639,640,641,642,643,644,645,646,647,648,649,650,651,652,653,654,655,656,657,658,659,660,661,662,663,664,665,666,667,668,669,670,671,672,673,674,675,676,677,678,679,680,681,682,683,684,685,686,687,688,689,690,691,692,693,694,695,696,697,698,699,700,701,702,703,704,705,706,707,708,709,710,711,712,713,714,715,716,717,718,719,720,721,722,723,724,725,726,727,728,729,730,731,732,733,734,735,736,737,738,739,740,741,742,743,744,745,746,747,748,749,750,751,752,753,754,755,756,757,758,759,760,761,762,763,764,765,766,767,768,769,770,771,772,773,774,775,776,777,778,779,780,781,782,783,784,785,786,787,788,789,790,791,792,793,794,795,796]::int[]);
  GET DIAGNOSTICS affected = ROW_COUNT;
  IF affected <> 205 THEN RAISE EXCEPTION 'Unexpected deletion count: media_analysis_jobs: %',affected; END IF;
  RAISE NOTICE 'Deleted media_analysis_jobs: %',affected;

  DELETE FROM "nextcloud_files" WHERE event_id=ANY(ARRAY[29,30,31,224]::int[]);
  GET DIAGNOSTICS affected = ROW_COUNT;
  IF affected <> 209 THEN RAISE EXCEPTION 'Unexpected deletion count: nextcloud_files: %',affected; END IF;
  RAISE NOTICE 'Deleted nextcloud_files: %',affected;

  DELETE FROM "nextcloud_jobs" WHERE event_id=ANY(ARRAY[29,30,31,224]::int[]);
  GET DIAGNOSTICS affected = ROW_COUNT;
  IF affected <> 1 THEN RAISE EXCEPTION 'Unexpected deletion count: nextcloud_jobs: %',affected; END IF;
  RAISE NOTICE 'Deleted nextcloud_jobs: %',affected;

  DELETE FROM "community_likes" WHERE media_id=ANY(ARRAY[170,171,172,173,592,593,594,595,596,597,598,599,600,601,602,603,604,605,606,607,608,609,610,611,612,613,614,615,616,617,618,619,620,621,622,623,624,625,626,627,628,629,630,631,632,633,634,635,636,637,638,639,640,641,642,643,644,645,646,647,648,649,650,651,652,653,654,655,656,657,658,659,660,661,662,663,664,665,666,667,668,669,670,671,672,673,674,675,676,677,678,679,680,681,682,683,684,685,686,687,688,689,690,691,692,693,694,695,696,697,698,699,700,701,702,703,704,705,706,707,708,709,710,711,712,713,714,715,716,717,718,719,720,721,722,723,724,725,726,727,728,729,730,731,732,733,734,735,736,737,738,739,740,741,742,743,744,745,746,747,748,749,750,751,752,753,754,755,756,757,758,759,760,761,762,763,764,765,766,767,768,769,770,771,772,773,774,775,776,777,778,779,780,781,782,783,784,785,786,787,788,789,790,791,792,793,794,795,796]::int[]) OR event_id=ANY(ARRAY[29,30,31,224]::int[]);
  GET DIAGNOSTICS affected = ROW_COUNT;
  IF affected <> 2 THEN RAISE EXCEPTION 'Unexpected deletion count: community_likes: %',affected; END IF;
  RAISE NOTICE 'Deleted community_likes: %',affected;

  DELETE FROM "community_favorites" WHERE media_id=ANY(ARRAY[170,171,172,173,592,593,594,595,596,597,598,599,600,601,602,603,604,605,606,607,608,609,610,611,612,613,614,615,616,617,618,619,620,621,622,623,624,625,626,627,628,629,630,631,632,633,634,635,636,637,638,639,640,641,642,643,644,645,646,647,648,649,650,651,652,653,654,655,656,657,658,659,660,661,662,663,664,665,666,667,668,669,670,671,672,673,674,675,676,677,678,679,680,681,682,683,684,685,686,687,688,689,690,691,692,693,694,695,696,697,698,699,700,701,702,703,704,705,706,707,708,709,710,711,712,713,714,715,716,717,718,719,720,721,722,723,724,725,726,727,728,729,730,731,732,733,734,735,736,737,738,739,740,741,742,743,744,745,746,747,748,749,750,751,752,753,754,755,756,757,758,759,760,761,762,763,764,765,766,767,768,769,770,771,772,773,774,775,776,777,778,779,780,781,782,783,784,785,786,787,788,789,790,791,792,793,794,795,796]::int[]) OR event_id=ANY(ARRAY[29,30,31,224]::int[]);
  GET DIAGNOSTICS affected = ROW_COUNT;
  IF affected <> 1 THEN RAISE EXCEPTION 'Unexpected deletion count: community_favorites: %',affected; END IF;
  RAISE NOTICE 'Deleted community_favorites: %',affected;

  DELETE FROM "download_history" WHERE media_id=ANY(ARRAY[170,171,172,173,592,593,594,595,596,597,598,599,600,601,602,603,604,605,606,607,608,609,610,611,612,613,614,615,616,617,618,619,620,621,622,623,624,625,626,627,628,629,630,631,632,633,634,635,636,637,638,639,640,641,642,643,644,645,646,647,648,649,650,651,652,653,654,655,656,657,658,659,660,661,662,663,664,665,666,667,668,669,670,671,672,673,674,675,676,677,678,679,680,681,682,683,684,685,686,687,688,689,690,691,692,693,694,695,696,697,698,699,700,701,702,703,704,705,706,707,708,709,710,711,712,713,714,715,716,717,718,719,720,721,722,723,724,725,726,727,728,729,730,731,732,733,734,735,736,737,738,739,740,741,742,743,744,745,746,747,748,749,750,751,752,753,754,755,756,757,758,759,760,761,762,763,764,765,766,767,768,769,770,771,772,773,774,775,776,777,778,779,780,781,782,783,784,785,786,787,788,789,790,791,792,793,794,795,796]::int[]);
  GET DIAGNOSTICS affected = ROW_COUNT;
  IF affected <> 1 THEN RAISE EXCEPTION 'Unexpected deletion count: download_history: %',affected; END IF;
  RAISE NOTICE 'Deleted download_history: %',affected;

  DELETE FROM "download_operations" WHERE media_id=ANY(ARRAY[170,171,172,173,592,593,594,595,596,597,598,599,600,601,602,603,604,605,606,607,608,609,610,611,612,613,614,615,616,617,618,619,620,621,622,623,624,625,626,627,628,629,630,631,632,633,634,635,636,637,638,639,640,641,642,643,644,645,646,647,648,649,650,651,652,653,654,655,656,657,658,659,660,661,662,663,664,665,666,667,668,669,670,671,672,673,674,675,676,677,678,679,680,681,682,683,684,685,686,687,688,689,690,691,692,693,694,695,696,697,698,699,700,701,702,703,704,705,706,707,708,709,710,711,712,713,714,715,716,717,718,719,720,721,722,723,724,725,726,727,728,729,730,731,732,733,734,735,736,737,738,739,740,741,742,743,744,745,746,747,748,749,750,751,752,753,754,755,756,757,758,759,760,761,762,763,764,765,766,767,768,769,770,771,772,773,774,775,776,777,778,779,780,781,782,783,784,785,786,787,788,789,790,791,792,793,794,795,796]::int[]);
  GET DIAGNOSTICS affected = ROW_COUNT;
  IF affected <> 1 THEN RAISE EXCEPTION 'Unexpected deletion count: download_operations: %',affected; END IF;
  RAISE NOTICE 'Deleted download_operations: %',affected;

  DELETE FROM "media_items" WHERE id=ANY(ARRAY[170,171,172,173,592,593,594,595,596,597,598,599,600,601,602,603,604,605,606,607,608,609,610,611,612,613,614,615,616,617,618,619,620,621,622,623,624,625,626,627,628,629,630,631,632,633,634,635,636,637,638,639,640,641,642,643,644,645,646,647,648,649,650,651,652,653,654,655,656,657,658,659,660,661,662,663,664,665,666,667,668,669,670,671,672,673,674,675,676,677,678,679,680,681,682,683,684,685,686,687,688,689,690,691,692,693,694,695,696,697,698,699,700,701,702,703,704,705,706,707,708,709,710,711,712,713,714,715,716,717,718,719,720,721,722,723,724,725,726,727,728,729,730,731,732,733,734,735,736,737,738,739,740,741,742,743,744,745,746,747,748,749,750,751,752,753,754,755,756,757,758,759,760,761,762,763,764,765,766,767,768,769,770,771,772,773,774,775,776,777,778,779,780,781,782,783,784,785,786,787,788,789,790,791,792,793,794,795,796]::int[]);
  GET DIAGNOSTICS affected = ROW_COUNT;
  IF affected <> 209 THEN RAISE EXCEPTION 'Unexpected deletion count: media_items: %',affected; END IF;
  RAISE NOTICE 'Deleted media_items: %',affected;

  DELETE FROM "events" WHERE id=ANY(ARRAY[29,30,31]::int[]);
  GET DIAGNOSTICS affected = ROW_COUNT;
  IF affected <> 3 THEN RAISE EXCEPTION 'Unexpected deletion count: events: %',affected; END IF;
  RAISE NOTICE 'Deleted events: %',affected;
  UPDATE events SET visibility='draft',admin_hidden=true,cover_image=NULL,custom_thumbnail=NULL WHERE id=224;
  GET DIAGNOSTICS affected = ROW_COUNT;
  IF affected<>1 THEN RAISE EXCEPTION 'Container update count mismatch'; END IF;
  IF (SELECT to_jsonb(e)-ARRAY['visibility','admin_hidden','cover_image','custom_thumbnail']
    FROM events e WHERE id=224) IS DISTINCT FROM original_container
    THEN RAISE EXCEPTION 'Unapproved container metadata change'; END IF;
  IF (SELECT count(*) FROM events)<>1 OR NOT EXISTS(SELECT 1 FROM events WHERE id=224
    AND visibility='draft' AND admin_hidden=true AND cover_image IS NULL AND custom_thumbnail IS NULL)
    THEN RAISE EXCEPTION 'Container postcondition failed'; END IF;

  IF EXISTS(SELECT 1 FROM "media_items") THEN RAISE EXCEPTION 'Unexpected remaining rows: media_items'; END IF;

  IF EXISTS(SELECT 1 FROM "media_analysis_jobs") THEN RAISE EXCEPTION 'Unexpected remaining rows: media_analysis_jobs'; END IF;

  IF EXISTS(SELECT 1 FROM "nextcloud_files") THEN RAISE EXCEPTION 'Unexpected remaining rows: nextcloud_files'; END IF;

  IF EXISTS(SELECT 1 FROM "nextcloud_jobs") THEN RAISE EXCEPTION 'Unexpected remaining rows: nextcloud_jobs'; END IF;

  IF EXISTS(SELECT 1 FROM "community_likes") THEN RAISE EXCEPTION 'Unexpected remaining rows: community_likes'; END IF;

  IF EXISTS(SELECT 1 FROM "community_favorites") THEN RAISE EXCEPTION 'Unexpected remaining rows: community_favorites'; END IF;

  IF EXISTS(SELECT 1 FROM "download_history") THEN RAISE EXCEPTION 'Unexpected remaining rows: download_history'; END IF;

  IF EXISTS(SELECT 1 FROM "download_operations") THEN RAISE EXCEPTION 'Unexpected remaining rows: download_operations'; END IF;

  SELECT n,digest INTO actual_n,actual_digest FROM (select count(*)::int as n,
  encode(sha256(convert_to(coalesce(string_agg(h,',' order by h),''),'UTF8')),'hex') as digest
  from (select encode(sha256(convert_to(to_jsonb(r)::text,'UTF8')),'hex') h from "beta_rate_limits" r) hashes) snapshot;
  IF actual_n <> 8 OR actual_digest <> '4a0e7af25fabba33419b46c1b4970a116afb8103d3b7f491652e19a108ced342'
    THEN RAISE EXCEPTION 'Approved fingerprint mismatch: beta_rate_limits. Stop; renewed approval required.'; END IF;

  SELECT n,digest INTO actual_n,actual_digest FROM (select count(*)::int as n,
  encode(sha256(convert_to(coalesce(string_agg(h,',' order by h),''),'UTF8')),'hex') as digest
  from (select encode(sha256(convert_to(to_jsonb(r)::text,'UTF8')),'hex') h from "creator_event_associations" r) hashes) snapshot;
  IF actual_n <> 0 OR actual_digest <> 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'
    THEN RAISE EXCEPTION 'Approved fingerprint mismatch: creator_event_associations. Stop; renewed approval required.'; END IF;

  SELECT n,digest INTO actual_n,actual_digest FROM (select count(*)::int as n,
  encode(sha256(convert_to(coalesce(string_agg(h,',' order by h),''),'UTF8')),'hex') as digest
  from (select encode(sha256(convert_to(to_jsonb(r)::text,'UTF8')),'hex') h from "creator_follows" r) hashes) snapshot;
  IF actual_n <> 0 OR actual_digest <> 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'
    THEN RAISE EXCEPTION 'Approved fingerprint mismatch: creator_follows. Stop; renewed approval required.'; END IF;

  SELECT n,digest INTO actual_n,actual_digest FROM (select count(*)::int as n,
  encode(sha256(convert_to(coalesce(string_agg(h,',' order by h),''),'UTF8')),'hex') as digest
  from (select encode(sha256(convert_to(to_jsonb(r)::text,'UTF8')),'hex') h from "email_verifications" r) hashes) snapshot;
  IF actual_n <> 2 OR actual_digest <> 'b020c7960be2ac67fb1a5b73473c44c68332353af2fc9f7580cfdc65aee56af0'
    THEN RAISE EXCEPTION 'Approved fingerprint mismatch: email_verifications. Stop; renewed approval required.'; END IF;

  SELECT n,digest INTO actual_n,actual_digest FROM (select count(*)::int as n,
  encode(sha256(convert_to(coalesce(string_agg(h,',' order by h),''),'UTF8')),'hex') as digest
  from (select encode(sha256(convert_to(to_jsonb(r)::text,'UTF8')),'hex') h from "event_entries" r) hashes) snapshot;
  IF actual_n <> 0 OR actual_digest <> 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'
    THEN RAISE EXCEPTION 'Approved fingerprint mismatch: event_entries. Stop; renewed approval required.'; END IF;

  SELECT n,digest INTO actual_n,actual_digest FROM (select count(*)::int as n,
  encode(sha256(convert_to(coalesce(string_agg(h,',' order by h),''),'UTF8')),'hex') as digest
  from (select encode(sha256(convert_to(to_jsonb(r)::text,'UTF8')),'hex') h from "media_cleanup" r) hashes) snapshot;
  IF actual_n <> 0 OR actual_digest <> 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'
    THEN RAISE EXCEPTION 'Approved fingerprint mismatch: media_cleanup. Stop; renewed approval required.'; END IF;

  SELECT n,digest INTO actual_n,actual_digest FROM (select count(*)::int as n,
  encode(sha256(convert_to(coalesce(string_agg(h,',' order by h),''),'UTF8')),'hex') as digest
  from (select encode(sha256(convert_to(to_jsonb(r)::text,'UTF8')),'hex') h from "media_reservations" r) hashes) snapshot;
  IF actual_n <> 0 OR actual_digest <> 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'
    THEN RAISE EXCEPTION 'Approved fingerprint mismatch: media_reservations. Stop; renewed approval required.'; END IF;

  SELECT n,digest INTO actual_n,actual_digest FROM (select count(*)::int as n,
  encode(sha256(convert_to(coalesce(string_agg(h,',' order by h),''),'UTF8')),'hex') as digest
  from (select encode(sha256(convert_to(to_jsonb(r)::text,'UTF8')),'hex') h from "nextcloud_sources" r) hashes) snapshot;
  IF actual_n <> 1 OR actual_digest <> 'f792a01205b810f26d131725c22864d7acf2557ed06a7b6c4ed987333a440e9e'
    THEN RAISE EXCEPTION 'Approved fingerprint mismatch: nextcloud_sources. Stop; renewed approval required.'; END IF;

  SELECT n,digest INTO actual_n,actual_digest FROM (select count(*)::int as n,
  encode(sha256(convert_to(coalesce(string_agg(h,',' order by h),''),'UTF8')),'hex') as digest
  from (select encode(sha256(convert_to(to_jsonb(r)::text,'UTF8')),'hex') h from "reference_documents" r) hashes) snapshot;
  IF actual_n <> 1 OR actual_digest <> '8cc24d8d725bf53475400db5f4d76a5bd9123013506c7a7d03faf5ab7ef37a8e'
    THEN RAISE EXCEPTION 'Approved fingerprint mismatch: reference_documents. Stop; renewed approval required.'; END IF;

  SELECT n,digest INTO actual_n,actual_digest FROM (select count(*)::int as n,
  encode(sha256(convert_to(coalesce(string_agg(h,',' order by h),''),'UTF8')),'hex') as digest
  from (select encode(sha256(convert_to(to_jsonb(r)::text,'UTF8')),'hex') h from "safety_results" r) hashes) snapshot;
  IF actual_n <> 5 OR actual_digest <> '699db7901d4330dd2218c5016879962f0f18fbfe1a818c95a13f9e36e904d1b2'
    THEN RAISE EXCEPTION 'Approved fingerprint mismatch: safety_results. Stop; renewed approval required.'; END IF;

  SELECT n,digest INTO actual_n,actual_digest FROM (select count(*)::int as n,
  encode(sha256(convert_to(coalesce(string_agg(h,',' order by h),''),'UTF8')),'hex') as digest
  from (select encode(sha256(convert_to(to_jsonb(r)::text,'UTF8')),'hex') h from "safety_reviews" r) hashes) snapshot;
  IF actual_n <> 0 OR actual_digest <> 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'
    THEN RAISE EXCEPTION 'Approved fingerprint mismatch: safety_reviews. Stop; renewed approval required.'; END IF;

  SELECT n,digest INTO actual_n,actual_digest FROM (select count(*)::int as n,
  encode(sha256(convert_to(coalesce(string_agg(h,',' order by h),''),'UTF8')),'hex') as digest
  from (select encode(sha256(convert_to(to_jsonb(r)::text,'UTF8')),'hex') h from "series" r) hashes) snapshot;
  IF actual_n <> 3 OR actual_digest <> '1ee4452d85d55882c5a483accb6b5e3d5af27ffa33dece6f38a20b20b3cfff6e'
    THEN RAISE EXCEPTION 'Approved fingerprint mismatch: series. Stop; renewed approval required.'; END IF;

  SELECT n,digest INTO actual_n,actual_digest FROM (select count(*)::int as n,
  encode(sha256(convert_to(coalesce(string_agg(h,',' order by h),''),'UTF8')),'hex') as digest
  from (select encode(sha256(convert_to(to_jsonb(r)::text,'UTF8')),'hex') h from "session" r) hashes) snapshot;
  IF actual_n <> 3 OR actual_digest <> 'f06ea7d22dab2190715d737882fac9bf103bd9a0a1dd869d9f6e300fa1c57504'
    THEN RAISE EXCEPTION 'Approved fingerprint mismatch: session. Stop; renewed approval required.'; END IF;

  SELECT n,digest INTO actual_n,actual_digest FROM (select count(*)::int as n,
  encode(sha256(convert_to(coalesce(string_agg(h,',' order by h),''),'UTF8')),'hex') as digest
  from (select encode(sha256(convert_to(to_jsonb(r)::text,'UTF8')),'hex') h from "transactional_emails" r) hashes) snapshot;
  IF actual_n <> 1 OR actual_digest <> '4c88e4f1308cb11783c3f0c5ef50298649c23d20ba6005fb430d14e0b0550bae'
    THEN RAISE EXCEPTION 'Approved fingerprint mismatch: transactional_emails. Stop; renewed approval required.'; END IF;

  SELECT n,digest INTO actual_n,actual_digest FROM (select count(*)::int as n,
  encode(sha256(convert_to(coalesce(string_agg(h,',' order by h),''),'UTF8')),'hex') as digest
  from (select encode(sha256(convert_to(to_jsonb(r)::text,'UTF8')),'hex') h from "users" r) hashes) snapshot;
  IF actual_n <> 37 OR actual_digest <> 'ab6d5b337713bf81d6656ac6e6f74e7b413008219e5c769ecb14981757de198c'
    THEN RAISE EXCEPTION 'Approved fingerprint mismatch: users. Stop; renewed approval required.'; END IF;
  IF (SELECT digest FROM (select encode(sha256(convert_to(coalesce(string_agg(v,',' order by v),''),'UTF8')),'hex') as digest from (
 select 'column:'||table_name||':'||column_name||':'||data_type||':'||is_nullable||':'||coalesce(column_default,'') as v
 from information_schema.columns where table_schema='public'
 union all select 'constraint:'||c.relname||':'||pg_get_constraintdef(x.oid)
 from pg_constraint x join pg_class c on c.oid=x.conrelid join pg_namespace n on n.oid=c.relnamespace where n.nspname='public'
 union all select 'trigger:'||c.relname||':'||pg_get_triggerdef(t.oid)
 from pg_trigger t join pg_class c on c.oid=t.tgrelid join pg_namespace n on n.oid=c.relnamespace
 where n.nspname='public' and not t.tgisinternal) definitions) snapshot)<>'e611361bab569d08b64584b357ef40ea8026a41288e052200c8d12c842d6c5d2'
    THEN RAISE EXCEPTION 'Schema changed during cleanup'; END IF;
  RAISE NOTICE 'PASS inside transaction: 209 media + 3 events deleted; all protected rows unchanged';
END $cleanup$;
SELECT (SELECT count(*) FROM media_items) AS remaining_media,
  (SELECT array_agg(id ORDER BY id) FROM events) AS remaining_event_ids,
  (SELECT count(*) FROM users) AS preserved_users,
  (SELECT count(*) FROM series) AS preserved_series,
  (SELECT count(*) FROM reference_documents WHERE id=48 AND event_id=224) AS preserved_document,
  (SELECT count(*) FROM nextcloud_sources WHERE event_id=224) AS preserved_connection;
-- Results above are transactional only. This file does not persist cleanup.
ROLLBACK;
