import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import * as schema from "./schema";

// postgres.js works against both a local Postgres (dev) and Neon's pooled
// endpoint (prod). `prepare: false` is required for transaction-pooled
// connections (PgBouncer / Neon pooler); a small pool keeps us well within
// serverless connection limits. The client connects lazily on first query, so
// constructing it with a placeholder is safe at build time when DATABASE_URL is
// not yet present — queries then fail loudly at runtime if it was never set.
const connectionString = process.env.DATABASE_URL ?? "postgresql://invalid:invalid@127.0.0.1:1/none";

const globalForDb = globalThis as unknown as { _pg?: ReturnType<typeof postgres> };

const client =
  globalForDb._pg ??
  postgres(connectionString, {
    max: 5,
    prepare: false,
    idle_timeout: 20,
  });

if (process.env.NODE_ENV !== "production") globalForDb._pg = client;

export const db = drizzle(client, { schema });
export { schema };
