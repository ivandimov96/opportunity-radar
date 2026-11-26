/** Microsoft sends the browser back here. The state must match the one we set; then the account is found or created and signed in. */
import { NextResponse, type NextRequest } from "next/server";
import { landingAfterSignIn, startSession } from "@/lib/auth";
import { MICROSOFT_SIGNIN_COOKIE, microsoftIdentity, microsoftSignInConfigured, userForMicrosoft } from "@/lib/auth/microsoft";
import { siteOrigin } from "@/lib/mail/microsoft";

export async function GET(req: NextRequest) {
  const origin = siteOrigin(req);
  const fail = (message: string) => NextResponse.redirect(new URL(`/login?error=${encodeURIComponent(message)}`, origin));
  if (!microsoftSignInConfigured()) return fail("Signing in with Microsoft is not set up yet.");
  const state = req.cookies.get(MICROSOFT_SIGNIN_COOKIE)?.value;
  const code = req.nextUrl.searchParams.get("code");
  if (!code || !state || req.nextUrl.searchParams.get("state") !== state) return fail("The Microsoft sign-in was interrupted. Please try again.");
  try {
    const user = await userForMicrosoft(await microsoftIdentity(origin, code));
    await startSession(user);
    const res = NextResponse.redirect(new URL(await landingAfterSignIn(user), origin));
    res.cookies.delete(MICROSOFT_SIGNIN_COOKIE);
    return res;
  } catch (err) {
    return fail(err instanceof Error ? err.message : "The Microsoft sign-in did not work.");
  }
}
