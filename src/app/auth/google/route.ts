/** Starts "Continue with Google": remembers a one-time state and sends the browser to Google. */
import { NextResponse, type NextRequest } from "next/server";
import { GOOGLE_STATE_COOKIE, googleAuthUrl, googleConfigured, randomToken } from "@/lib/auth/google";

export async function GET(req: NextRequest) {
  const origin = req.nextUrl.origin;
  if (!googleConfigured()) return NextResponse.redirect(new URL(`/login?error=${encodeURIComponent("Signing in with Google is not set up yet. Use your email and password for now.")}`, origin));
  const state = randomToken();
  const nonce = randomToken();
  const res = NextResponse.redirect(googleAuthUrl(origin, state, nonce));
  res.cookies.set(GOOGLE_STATE_COOKIE, `${state}.${nonce}`, { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/auth/google", maxAge: 600 });
  return res;
}
