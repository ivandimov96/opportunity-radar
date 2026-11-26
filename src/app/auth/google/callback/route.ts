/** Google sends the browser back here. The state must match the one we set; then the account is found or created and signed in. */
import { NextResponse, type NextRequest } from "next/server";
import { landingAfterSignIn, startSession } from "@/lib/auth";
import { GOOGLE_STATE_COOKIE, googleConfigured, googleProfile, userForGoogle } from "@/lib/auth/google";

export async function GET(req: NextRequest) {
  const origin = req.nextUrl.origin;
  const fail = (message: string) => NextResponse.redirect(new URL(`/login?error=${encodeURIComponent(message)}`, origin));
  if (!googleConfigured()) return fail("Signing in with Google is not set up yet.");
  const [state, nonce] = (req.cookies.get(GOOGLE_STATE_COOKIE)?.value ?? "").split(".");
  const code = req.nextUrl.searchParams.get("code");
  if (!code || !state || !nonce || req.nextUrl.searchParams.get("state") !== state) return fail("The Google sign-in was interrupted. Please try again.");
  try {
    const user = await userForGoogle(await googleProfile(origin, code, nonce));
    await startSession(user);
    const res = NextResponse.redirect(new URL(await landingAfterSignIn(user), origin));
    res.cookies.delete(GOOGLE_STATE_COOKIE);
    return res;
  } catch (err) {
    return fail(err instanceof Error ? err.message : "The Google sign-in did not work.");
  }
}
