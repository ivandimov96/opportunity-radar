/** Starts "Continue with Microsoft": remembers a one-time state and sends the browser to Microsoft's sign-in page. */
import { NextResponse, type NextRequest } from "next/server";
import { MICROSOFT_SIGNIN_COOKIE, microsoftSignInConfigured, microsoftSignInUrl } from "@/lib/auth/microsoft";
import { randomState, siteOrigin } from "@/lib/mail/microsoft";

export async function GET(req: NextRequest) {
  const origin = siteOrigin(req);
  if (!microsoftSignInConfigured()) return NextResponse.redirect(new URL(`/login?error=${encodeURIComponent("Signing in with Microsoft is not set up yet. Use your email and password for now.")}`, origin));
  const state = randomState();
  const res = NextResponse.redirect(microsoftSignInUrl(origin, state));
  res.cookies.set(MICROSOFT_SIGNIN_COOKIE, state, { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/auth/microsoft", maxAge: 600 });
  return res;
}
