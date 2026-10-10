import { getTableColumns, getTableName } from "drizzle-orm";
import { events, eventEntries, mediaItems, mediaAnalysisJobs, referenceDocuments, users, emailVerifications, betaRateLimits, safetyResults, safetyReviews, mediaReservations, mediaCleanup, communityLikes, communityFavorites, downloadOperations, downloadHistory } from "@shared/schema";

export const recognitionSchemaRequirements = [events, eventEntries, mediaItems, mediaAnalysisJobs, referenceDocuments, users, emailVerifications, betaRateLimits, safetyResults, safetyReviews, mediaReservations, mediaCleanup, communityLikes, communityFavorites, downloadOperations, downloadHistory]
  .flatMap(table => Object.values(getTableColumns(table)).map(column => ({
    table: getTableName(table), column: column.name,
  })));
type Query = (sql: string, values: unknown[]) => Promise<{ rows: { table_name: string; column_name: string }[] }>;

/** Read-only rollout gate. Schema changes are deliberately not performed at startup. */
export async function verifyRecognitionSchema(query?: Query) {
  const run = query || (await import("./db")).pool.query.bind((await import("./db")).pool);
  let rows: { table_name: string; column_name: string }[];
  try {
    ({ rows } = await run(`select table_name, column_name from information_schema.columns
      where table_schema = current_schema() and table_name = any($1::text[])`,
    [Array.from(new Set(recognitionSchemaRequirements.map(item => item.table)))]));
  } catch {
    throw new Error("Database schema could not be verified. Startup refused; check database connectivity and deployment schema setup.");
  }
  const available = new Set(rows.map(row => `${row.table_name}.${row.column_name}`));
  const missing = recognitionSchemaRequirements.filter(item => !available.has(`${item.table}.${item.column}`));
  if (missing.length) {
    throw new Error(`Database schema is not ready for this release. Apply the approved schema changes before serving it. Missing: ${missing.map(item => `${item.table}.${item.column}`).join(", ")}`);
  }
}
