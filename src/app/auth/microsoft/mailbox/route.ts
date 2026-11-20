/** Starts "Sign in with Microsoft" for a mailbox: remembers a one-time state and sends the browser to Microsoft's sign-in page. */
import { NextResponse, type NextRequest } from "next/server";
import { currentUser } from "@/lib/auth";
import { MICROSOFT_STATE_COOKIE, microsoftAuthUrl, microsoftConfigured, randomState, siteOrigin } from "@/lib/mail/microsoft";
import { settingsHref } from "@/lib/settings-nav";

export async function GET(req: NextRequest) {
  const origin = siteOrigin(req);
  const user = await currentUser();
  if (!user) return NextResponse.redirect(new URL("/login", origin));
  if (user.role !== "owner") return NextResponse.redirect(new URL("/welcome", origin));
  const back = (message: string) => NextResponse.redirect(new URL(`${settingsHref("mailbox")}${settingsHref("mailbox").includes("?") ? "&" : "?"}error=${encodeURIComponent(message)}`, origin));
  if (!microsoftConfigured()) return back("Signing in with Microsoft is not switched on yet. Add the mailbox with an app password for now.");
  const state = randomState();
  const res = NextResponse.redirect(microsoftAuthUrl(origin, state));
  // The state is tied to this browser and this account: the answer is accepted only where the question was asked.
  // Started from the first-run setup, the answer leads back to it.
  const from = req.nextUrl.searchParams.get("from") === "setup" ? "setup" : "settings";
  res.cookies.set(MICROSOFT_STATE_COOKIE, `${state}.${user.id}.${from}`, { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/auth/microsoft", maxAge: 600 });
  return res;
}
