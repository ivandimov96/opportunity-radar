/**
 * Secrets a customer hands over (a mailbox app password) are stored encrypted:
 * AES-256-GCM with a key derived from MAILBOX_SECRET (or AUTH_SECRET when that
 * is not set). The database alone is not enough to read them, and a value that
 * was changed in the database does not decrypt. The clear text exists only in
 * memory, on the server, at the moment a connection is opened.
 *
 * Changing the secret makes stored passwords unreadable: the mailbox then shows
 * as "connect again", nothing is sent with a wrong password.
 */
import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from "node:crypto";

function key(): Buffer {
  const s = process.env.MAILBOX_SECRET || process.env.AUTH_SECRET;
  if (!s || s.length < 16) {
    if (process.env.NODE_ENV === "production") throw new Error("MAILBOX_SECRET (or AUTH_SECRET) is not set: a mailbox password cannot be stored safely.");
    return Buffer.from(hkdfSync("sha256", "development-only-secret-not-for-production", "radar", "mailbox", 32));
  }
  return Buffer.from(hkdfSync("sha256", s, "radar", "mailbox", 32));
}

/** `v1.<iv>.<tag>.<ciphertext>`, all base64url. */
export function seal(plain: string): string {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", key(), iv);
  const body = Buffer.concat([c.update(plain, "utf8"), c.final()]);
  return ["v1", iv.toString("base64url"), c.getAuthTag().toString("base64url"), body.toString("base64url")].join(".");
}

/** The clear text, or null when it cannot be read (the secret changed, or the stored value was altered). */
export function open(sealed: string): string | null {
  const [v, iv, tag, body] = sealed.split(".");
  if (v !== "v1" || !iv || !tag || body === undefined) return null;
  try {
    const d = createDecipheriv("aes-256-gcm", key(), Buffer.from(iv, "base64url"));
    d.setAuthTag(Buffer.from(tag, "base64url"));
    return Buffer.concat([d.update(Buffer.from(body, "base64url")), d.final()]).toString("utf8");
  } catch {
    return null;
  }
}
