/**
 * The session cookie: "<session id>.<role>.<signature>". The signature is an
 * HMAC over the first two parts with AUTH_SECRET, so a cookie cannot be made
 * up or changed. This file uses only Web Crypto, so the request guard
 * (src/proxy.ts) can check a cookie without opening the database.
 */
export const SESSION_COOKIE = "radar_session";
export type Role = "owner" | "member";

function secret(): string {
  const s = process.env.AUTH_SECRET;
  if (s && s.length >= 16) return s;
  if (process.env.NODE_ENV === "production") throw new Error("AUTH_SECRET is not set (at least 16 characters).");
  return "development-only-secret-not-for-production";
}

const b64 = (buf: ArrayBuffer) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

async function sign(payload: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret()), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return b64(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payload)));
}

export async function makeToken(sessionId: string, role: Role): Promise<string> {
  const payload = `${sessionId}.${role}`;
  return `${payload}.${await sign(payload)}`;
}

/** The session id and role a cookie carries, or null when it is missing, malformed or not signed by us. */
export async function readToken(token: string | undefined | null): Promise<{ sessionId: string; role: Role } | null> {
  if (!token) return null;
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [sessionId, role, sig] = parts;
  if (role !== "owner" && role !== "member") return null;
  const expected = await sign(`${sessionId}.${role}`);
  if (expected.length !== sig.length) return null;
  let diff = 0;
  for (let i = 0; i < sig.length; i++) diff |= expected.charCodeAt(i) ^ sig.charCodeAt(i);
  return diff === 0 ? { sessionId, role } : null;
}
