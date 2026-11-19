/**
 * The request guard. Every request passes here before any page, action or API
 * route runs. Without a validly signed session cookie only the public pages
 * can be read; a signed-in member (an account without a workspace yet) is kept
 * to the welcome page. The cookie's signature is checked here; that the
 * session still exists is checked again where the page is rendered.
 */
import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE, readToken } from "@/lib/auth/token";

/** Readable by anyone. The landing page is "/"; signing in and up post to their own pages. */
const PUBLIC = new Set(["/", "/login", "/signup", "/auth/google", "/auth/google/callback", "/privacy", "/terms", "/acceptable-use"]);
/** Pages for signing in: someone already signed in is sent on. */
const SIGN_IN = new Set(["/login", "/signup", "/auth/google", "/auth/google/callback"]);
/** The legal documents: readable by everyone, signed in or not. */
const LEGAL = new Set(["/privacy", "/terms", "/acceptable-use"]);
/** What a member may open. */
const MEMBER = new Set(["/welcome"]);

export async function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;
  const token = await readToken(req.cookies.get(SESSION_COOKIE)?.value);
  const reading = req.method === "GET" || req.method === "HEAD";
  const headers = new Headers(req.headers);
  headers.set("x-pathname", pathname);
  const pass = () => NextResponse.next({ request: { headers } });
  const to = (path: string) => NextResponse.redirect(new URL(path, req.url), reading ? 307 : 303);

  if (token?.role === "owner") return SIGN_IN.has(pathname) ? to("/") : pass();
  if (token?.role === "member") return MEMBER.has(pathname) || LEGAL.has(pathname) ? pass() : to("/welcome");
  // Not signed in: the landing page can only be read; the sign-in and sign-up pages also take their own form.
  if (pathname === "/") return reading ? pass() : to("/login");
  if (PUBLIC.has(pathname)) return pass();
  return to(reading ? `/login?next=${encodeURIComponent(pathname)}` : "/login");
}

export const config = {
  // Everything except the framework's own files and the icons.
  matcher: ["/((?!_next/static|_next/image|favicon.ico|icon.svg|icon.png|apple-icon.png).*)"],
};
