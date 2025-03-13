import { Pool, neonConfig } from '@neondatabase/serverless';
import { drizzle } from 'drizzle-orm/neon-serverless';
import ws from "ws";
import * as schema from "@shared/schema";

neonConfig.webSocketConstructor = ws;

// Ensure we're using the correct protocol based on the environment
if (!process.env.DATABASE_URL) {
  throw new Error(
    "DATABASE_URL must be set. Did you forget to provision a database?",
  );
}

// Force WSS for production and development
const connectionString = process.env.DATABASE_URL.replace('postgresql://', 'postgres://');

export const pool = new Pool({ connectionString });
export const db = drizzle({ client: pool, schema });