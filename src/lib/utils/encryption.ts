import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from "crypto";

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12;
const AUTH_TAG_LENGTH = 16;
// Marks a value as our encrypted format vs. a pre-encryption legacy plaintext
// row already sitting in app_settings -- lets decryptSetting tell the two
// apart without a migration script (see decryptSetting's doc comment).
const PREFIX = "enc:v1:";

function getKey(): Buffer {
  const secret = process.env.SETTINGS_ENCRYPTION_KEY;
  if (!secret) {
    throw new Error("SETTINGS_ENCRYPTION_KEY is not configured — cannot encrypt/decrypt app settings.");
  }
  // scrypt derives a fixed-length key from whatever-length secret is
  // configured -- the salt is a fixed app-specific string (not per-value;
  // only the key needs to be unique to this app, the IV below provides the
  // per-value randomness AES-GCM needs).
  return scryptSync(secret, "amc-tracker-app-settings", 32);
}

export function encryptSetting(plaintext: string): string {
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, getKey(), iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return PREFIX + Buffer.concat([iv, authTag, encrypted]).toString("base64");
}

/**
 * Decrypts a value written by encryptSetting -- or, if `stored` doesn't
 * start with our format's prefix, returns it unchanged. This is what makes
 * the switch to encryption migration-free: every row already in
 * app_settings from before this existed is legacy plaintext (no prefix), so
 * it just keeps working as-is until the next time it's saved, at which
 * point it's transparently upgraded to encrypted.
 */
export function decryptSetting(stored: string): string {
  if (!stored.startsWith(PREFIX)) return stored;
  const raw = Buffer.from(stored.slice(PREFIX.length), "base64");
  const iv = raw.subarray(0, IV_LENGTH);
  const authTag = raw.subarray(IV_LENGTH, IV_LENGTH + AUTH_TAG_LENGTH);
  const encrypted = raw.subarray(IV_LENGTH + AUTH_TAG_LENGTH);
  const decipher = createDecipheriv(ALGORITHM, getKey(), iv);
  decipher.setAuthTag(authTag);
  return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString("utf8");
}
