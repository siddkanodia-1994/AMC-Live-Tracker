import { eq } from "drizzle-orm";
import { db } from "../db/client";
import { appSettings } from "../db/schema";

const DHAN_TOKEN_KEY = "dhan_access_token";
const DHAN_CLIENT_ID_KEY = "dhan_client_id";

export class DhanTokenMissingError extends Error {
  constructor() {
    super("No DHAN access token is configured. Add one from the /admin settings page.");
    this.name = "DhanTokenMissingError";
  }
}

export class DhanClientIdMissingError extends Error {
  constructor() {
    super("No DHAN client ID is configured. Add one from the /admin settings page.");
    this.name = "DhanClientIdMissingError";
  }
}

export async function getActiveDhanToken(): Promise<string> {
  const [row] = await db.select().from(appSettings).where(eq(appSettings.key, DHAN_TOKEN_KEY));
  if (!row) throw new DhanTokenMissingError();
  return row.value;
}

export async function setDhanToken(token: string): Promise<void> {
  await db
    .insert(appSettings)
    .values({ key: DHAN_TOKEN_KEY, value: token })
    .onConflictDoUpdate({
      target: appSettings.key,
      set: { value: token, updatedAt: new Date() },
    });
}

export async function getDhanTokenStatus(): Promise<{ configured: boolean; updatedAt: string | null }> {
  const [row] = await db.select().from(appSettings).where(eq(appSettings.key, DHAN_TOKEN_KEY));
  return {
    configured: Boolean(row),
    updatedAt: row ? row.updatedAt.toISOString() : null,
  };
}

// Client ID used to live purely as the DHAN_CLIENT_ID env var (fixed at
// deploy time). It's now a DB-stored, admin-editable setting -- symmetric to
// the token -- so switching to a different DHAN account doesn't need a
// redeploy. The env var stays as a fallback (not removed): it covers local
// dev before anyone's saved a DB value, and guards a fresh deploy where the
// app_settings row doesn't exist yet. Once someone saves via /admin, the DB
// row takes precedence permanently.
export async function getActiveDhanClientId(): Promise<string> {
  const [row] = await db.select().from(appSettings).where(eq(appSettings.key, DHAN_CLIENT_ID_KEY));
  if (row) return row.value;
  const envFallback = process.env.DHAN_CLIENT_ID;
  if (envFallback) return envFallback;
  throw new DhanClientIdMissingError();
}

export async function setDhanClientId(clientId: string): Promise<void> {
  await db
    .insert(appSettings)
    .values({ key: DHAN_CLIENT_ID_KEY, value: clientId })
    .onConflictDoUpdate({
      target: appSettings.key,
      set: { value: clientId, updatedAt: new Date() },
    });
}

export interface DhanClientIdStatus {
  configured: boolean;
  value: string | null;
  updatedAt: string | null;
  source: "db" | "env" | "none";
}

export async function getDhanClientIdStatus(): Promise<DhanClientIdStatus> {
  const [row] = await db.select().from(appSettings).where(eq(appSettings.key, DHAN_CLIENT_ID_KEY));
  if (row) {
    return { configured: true, value: row.value, updatedAt: row.updatedAt.toISOString(), source: "db" };
  }
  const envFallback = process.env.DHAN_CLIENT_ID;
  if (envFallback) {
    return { configured: true, value: envFallback, updatedAt: null, source: "env" };
  }
  return { configured: false, value: null, updatedAt: null, source: "none" };
}
