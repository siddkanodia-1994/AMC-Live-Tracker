import { eq } from "drizzle-orm";
import { db } from "../db/client";
import { appSettings } from "../db/schema";

const DHAN_TOKEN_KEY = "dhan_access_token";

export class DhanTokenMissingError extends Error {
  constructor() {
    super("No DHAN access token is configured. Add one from the /admin settings page.");
    this.name = "DhanTokenMissingError";
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
