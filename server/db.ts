import { Pool, neonConfig } from '@neondatabase/serverless';
import { drizzle } from 'drizzle-orm/neon-serverless';
import ws from "ws";
import * as schema from "@shared/schema";
import { assertDevelopmentMediaTarget } from "./development-media-target";

neonConfig.webSocketConstructor = ws;

// Ensure we're using the correct protocol based on the environment
if (!process.env.DATABASE_URL) {
  throw new Error(
    "DATABASE_URL must be set. Did you forget to provision a database?",
  );
}

// Force WSS for production and development
const connectionString = process.env.DATABASE_URL.replace('postgresql://', 'postgres://');
// Fail before creating a connection, not after a query has reached a wrong target.
if (process.env.MEDIA_STORAGE_ENVIRONMENT === "development") {
  const target = new URL(connectionString);
  const disposable = target.hostname === "127.0.0.1" &&
    !!process.env.VCO_TEST_PG_PROXY && !!process.env.VCO_TEST_OBJECTS &&
    process.env.REPLIT_DEPLOYMENT !== "1";
  if (!disposable) assertDevelopmentMediaTarget();
}

export const pool = new Pool({ connectionString });
export const db = drizzle({ client: pool, schema });