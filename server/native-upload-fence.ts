import {sql} from "drizzle-orm";
import {db} from "./db";
type Connection=typeof db|Parameters<Parameters<typeof db.transaction>[0]>[0];

/** Optional schema; absence is not cached across a later approved schema change. */
export async function nativeUploadFenceAvailable(connection:Connection=db){
  return !!(await connection.execute(sql`select to_regclass('media_r2_multipart_journals') as name`)).rows[0]?.name;
}
export async function nativeUploadOwnsSession(id:string,connection:Connection=db){
  // Completed/released receipts replace the pinned journal atomically.
  if((await connection.execute(sql`select 1 from media_upload_sessions
    where id=${id} and metadata ? 'nativeReceipt'`)).rows.length)return true;
  if(!await nativeUploadFenceAvailable(connection))return false;
  return !!(await connection.execute(sql`select 1 from media_r2_multipart_journals where session_id=${id}`)).rows.length;
}
