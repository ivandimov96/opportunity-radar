/**
 * "Sign in with Microsoft" for a mailbox (Outlook.com, Hotmail, Microsoft 365):
 * the standard OAuth 2.0 authorization-code flow, without any library. The
 * customer signs in on Microsoft's own page and allows this app to send and
 * read their mail; we never see a password. Microsoft hands back a long-lived
 * refresh token (stored encrypted, like an app password) from which a
 * one-hour access token is made whenever a connection is opened.
 *
 * It needs an app registered in Microsoft Entra, with its id and a client
 * secret in .env (MICROSOFT_CLIENT_ID, MICROSOFT_CLIENT_SECRET), the redirect
 * address <site>/auth/microsoft/mailbox/callback registered there, and the
 * delegated permissions IMAP.AccessAsUser.All and SMTP.Send (Office 365
 * Exchange Online) plus offline_access.
 */
import { randomBytes } from "node:crypto";

export const MICROSOFT_STATE_COOKIE = "radar_ms_mailbox_state";
export const MICROSOFT_CALLBACK_PATH = "/auth/microsoft/mailbox/callback";
/** The servers every Microsoft mailbox is reached through. */
export const MICROSOFT_SERVERS = { smtp: { host: "smtp.office365.com", port: 587 }, imap: { host: "outlook.office365.com", port: 993 } };
const AUTHORITY = "https://login.microsoftonline.com/common/oauth2/v2.0";
const SCOPE = "offline_access openid email profile https://outlook.office.com/IMAP.AccessAsUser.All https://outlook.office.com/SMTP.Send";

/**
 * The site's own address as the browser knows it: the one the redirect back must use, or the sign-in cookie is not
 * sent along. APP_URL says it outright; otherwise it is what the request was addressed to (behind a proxy, what the
 * proxy says). A made-up host gets nowhere: Microsoft only redirects to addresses registered for the app.
 */
export function siteOrigin(req: { headers: Headers; nextUrl: { protocol: string; origin: string } }): string {
  const fixed = process.env.APP_URL?.trim().replace(/\/+$/, "");
  if (fixed) return fixed;
  const host = (req.headers.get("x-forwarded-host") ?? req.headers.get("host") ?? "").split(",")[0].trim();
  if (!host || !/^[a-z0-9.-]+(:\d+)?$/i.test(host)) return req.nextUrl.origin;
  const proto = (req.headers.get("x-forwarded-proto") ?? req.nextUrl.protocol.replace(":", "")).split(",")[0].trim() === "https" ? "https" : "http";
  return `${proto}://${host}`;
}

export const microsoftConfigured = () => Boolean(process.env.MICROSOFT_CLIENT_ID && process.env.MICROSOFT_CLIENT_SECRET);
export const randomState = () => randomBytes(24).toString("base64url");

/** Where the browser is sent: Microsoft's sign-in page, asking for mail access for this app. */
export function microsoftAuthUrl(origin: string, state: string): string {
  const p = new URLSearchParams({ client_id: process.env.MICROSOFT_CLIENT_ID ?? "", response_type: "code", response_mode: "query", redirect_uri: `${origin}${MICROSOFT_CALLBACK_PATH}`, scope: SCOPE, state, prompt: "select_account" });
  return `${AUTHORITY}/authorize?${p}`;
}

/** Microsoft's own words for a refusal, shortened to one plain sentence. */
export class MicrosoftAuthError extends Error {
  constructor(
    message: string,
    /** The sign-in itself is no longer valid (revoked, expired, password changed): the mailbox must be connected again. */
    public readonly signInAgain = false,
  ) {
    super(message);
    this.name = "MicrosoftAuthError";
  }
}

interface TokenAnswer {
  access_token?: string;
  refresh_token?: string;
  id_token?: string;
  expires_in?: number;
  error?: string;
  error_description?: string;
}

async function token(body: Record<string, string>): Promise<TokenAnswer & { access_token: string }> {
  let res: Response;
  try {
    res = await fetch(`${AUTHORITY}/token`, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ client_id: process.env.MICROSOFT_CLIENT_ID ?? "", client_secret: process.env.MICROSOFT_CLIENT_SECRET ?? "", scope: SCOPE, ...body }), signal: AbortSignal.timeout(15_000) });
  } catch {
    throw new MicrosoftAuthError("Microsoft could not be reached. Try again in a moment.");
  }
  const answer = (await res.json().catch(() => ({}))) as TokenAnswer;
  if (!res.ok || !answer.access_token) {
    const why = (answer.error_description ?? answer.error ?? `answer ${res.status}`).split(/\r?\n/)[0].slice(0, 200);
    // invalid_grant: the consent was withdrawn, the password changed, or the token was unused for too long.
    throw new MicrosoftAuthError(answer.error === "invalid_grant" ? "Microsoft no longer accepts this sign-in. Remove this mailbox and sign in with Microsoft again." : `Microsoft refused: ${why}`, answer.error === "invalid_grant");
  }
  return answer as TokenAnswer & { access_token: string };
}

/** The claims of an id token. It came straight from Microsoft over TLS in answer to our own request, so it is read, not re-verified. */
function claims(idToken: string | undefined): { email?: string; preferred_username?: string } {
  try {
    return JSON.parse(Buffer.from((idToken ?? "").split(".")[1] ?? "", "base64url").toString("utf8"));
  } catch {
    return {};
  }
}

/** Exchanges the code Microsoft sent back for the mailbox's address and its tokens. */
export async function microsoftExchange(origin: string, code: string): Promise<{ address: string; refreshToken: string; accessToken: string; expiresIn: number }> {
  const t = await token({ grant_type: "authorization_code", code, redirect_uri: `${origin}${MICROSOFT_CALLBACK_PATH}` });
  const c = claims(t.id_token);
  const address = (c.email ?? c.preferred_username ?? "").trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(address)) throw new MicrosoftAuthError("Microsoft did not say which email address was signed in.");
  if (!t.refresh_token) throw new MicrosoftAuthError("Microsoft did not allow this app to stay connected. Try again and accept the request.");
  return { address, refreshToken: t.refresh_token, accessToken: t.access_token, expiresIn: t.expires_in ?? 3600 };
}

// Access tokens live about an hour; one is kept per mailbox and renewed a few minutes before it runs out.
const g = globalThis as unknown as { __radarMsTokens?: Map<string, { token: string; until: number }> };
const cache = (g.__radarMsTokens ??= new Map());

/** Puts a token that was just issued into the cache (the sign-in itself already produced one). */
export function rememberMicrosoftToken(key: string, accessToken: string, expiresIn: number) {
  cache.set(key, { token: accessToken, until: Date.now() + (expiresIn - 300) * 1000 });
}
export function forgetMicrosoftToken(key: string) {
  cache.delete(key);
}

/**
 * A valid access token for one mailbox. Microsoft may hand back a new refresh token with it;
 * `onRotate` stores that one, since the old one stops working.
 */
export async function microsoftAccessToken(key: string, refreshToken: string, onRotate: (next: string) => Promise<void>): Promise<string> {
  const hit = cache.get(key);
  if (hit && hit.until > Date.now()) return hit.token;
  const t = await token({ grant_type: "refresh_token", refresh_token: refreshToken });
  rememberMicrosoftToken(key, t.access_token, t.expires_in ?? 3600);
  if (t.refresh_token && t.refresh_token !== refreshToken) await onRotate(t.refresh_token);
  return t.access_token;
}
