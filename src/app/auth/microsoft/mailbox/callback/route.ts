/**
 * Microsoft sends the browser back here after the sign-in. The state must match the one we set for this
 * account; then the mailbox is opened once with the new sign-in and, only if that works, added to the workspace.
 */
import { revalidatePath } from "next/cache";
import { NextResponse, type NextRequest } from "next/server";
import { currentUser } from "@/lib/auth";
import { connectMicrosoftMailbox } from "@/lib/mail";
import { MICROSOFT_STATE_COOKIE, microsoftConfigured, siteOrigin, microsoftExchange } from "@/lib/mail/microsoft";
import { settingsHref } from "@/lib/settings-nav";
import { runInWorkspace } from "@/lib/workspace";

export async function GET(req: NextRequest) {
  const origin = siteOrigin(req);
  const user = await currentUser();
  if (!user) return NextResponse.redirect(new URL("/login", origin));
  if (user.role !== "owner") return NextResponse.redirect(new URL("/welcome", origin));
  const base = settingsHref("mailbox");
  const back = (kind: "ok" | "error", message: string) => {
    // Started from the first-run setup: on to its end when it worked, back to its mailbox step when it did not.
    const fromSetup = (req.cookies.get(MICROSOFT_STATE_COOKIE)?.value ?? "").split(".")[2] === "setup";
    const to = fromSetup ? (kind === "ok" ? "/setup?step=done" : `/setup?step=mailbox&error=${encodeURIComponent(message)}`) : `${base}${base.includes("?") ? "&" : "?"}${kind}=${encodeURIComponent(message)}`;
    const res = NextResponse.redirect(new URL(to, origin));
    res.cookies.delete({ name: MICROSOFT_STATE_COOKIE, path: "/auth/microsoft" });
    return res;
  };
  if (!microsoftConfigured()) return back("error", "Signing in with Microsoft is not switched on yet.");
  const q = req.nextUrl.searchParams;
  const [state, userId] = (req.cookies.get(MICROSOFT_STATE_COOKIE)?.value ?? "").split(".");
  // The person pressed Cancel on Microsoft's page, or an administrator has to approve the app first.
  if (q.get("error")) return back("error", q.get("error") === "access_denied" ? "The Microsoft sign-in was canceled, so no mailbox was added." : `Microsoft did not allow the sign-in: ${(q.get("error_description") ?? q.get("error") ?? "").split(/\r?\n/)[0].slice(0, 200)}`);
  const code = q.get("code");
  if (!code || !state || q.get("state") !== state || userId !== user.id) return back("error", "The Microsoft sign-in was interrupted. Please try again.");
  try {
    const signedIn = await microsoftExchange(origin, code);
    const res = await runInWorkspace(user.workspaceId, () => connectMicrosoftMailbox(signedIn));
    revalidatePath("/", "layout");
    return res.ok ? back("ok", `Connected ${res.address} with Microsoft: sending and reading both work.`) : back("error", res.error);
  } catch (err) {
    return back("error", err instanceof Error ? err.message : "The Microsoft sign-in did not work.");
  }
}
