import { Pool, neonConfig } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-serverless";
import ws from "ws";
import * as schema from "./schema";

// The Pool-based driver needs an explicit WebSocket implementation outside
// edge/browser runtimes (plain Node.js, e.g. CLI scripts and this app's
// Node-runtime API routes, has no compatible built-in one it can rely on).
neonConfig.webSocketConstructor = ws;

// Separate from lib/db/client.ts (neon-http) because the Excel import flow needs
// real interactive transactions (upsert -> read id -> delete -> bulk insert) which
// the HTTP driver can't do. This is only used by low-frequency admin import paths,
// where connection setup latency doesn't matter.
type TransactionalDb = ReturnType<typeof drizzle<typeof schema>>;

let instance: TransactionalDb | null = null;

// Lazily constructed for the same build-time reason as lib/db/client.ts.
function getTransactionalDb(): TransactionalDb {
  if (!instance) {
    if (!process.env.DATABASE_URL) {
      throw new Error("DATABASE_URL is not set");
    }
    instance = drizzle(new Pool({ connectionString: process.env.DATABASE_URL }), { schema });
  }
  return instance;
}

export const transactionalDb: TransactionalDb = new Proxy({} as TransactionalDb, {
  get(_target, prop, receiver) {
    return Reflect.get(getTransactionalDb(), prop, receiver);
  },
});
