import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { logoutAction, resendVerificationAction } from "@/app/auth-actions";
import { AuthFrame, FormError } from "@/components/auth-frame";
import { currentUser, landingAfterSignIn, mustConfirmEmail } from "@/lib/auth";
import { verifyEmail } from "@/lib/auth/verify";

export const metadata: Metadata = { title: "Confirm your email" };

/**
 * Two things happen here. The link from the email arrives with its secret and confirms the address. And a
 * person who signed up but has not confirmed yet waits here, with a way to have the link sent again.
 */
export default async function VerifyEmailPage({ searchParams }: { searchParams: Promise<{ token?: string; sent?: string; error?: string }> }) {
  const sp = await searchParams;
  if (sp.token) {
    const email = await verifyEmail(sp.token);
    const user = await currentUser();
    if (email) {
      // Confirmed. In the browser they signed up in, the app opens; elsewhere they sign in.
      if (user && user.email === email) redirect(await landingAfterSignIn(user));
      return (
        <AuthFrame title="Your email is confirmed" lead="Thank you. Your account is ready.">
          <Link href={`/login?email=${encodeURIComponent(email)}`} className="btn btn-primary btn-lg w-full">
            Sign in
          </Link>
        </AuthFrame>
      );
    }
    // A link that was already used leads on when its owner is here and confirmed.
    if (user && !mustConfirmEmail(user)) redirect(await landingAfterSignIn(user));
    return (
      <AuthFrame title="This link no longer works" lead="A link works once, and for one day.">
        <p className="text-[0.95rem] text-ink-muted">{user ? "Have a new one sent and use it straight away." : "Sign in and have a new one sent."}</p>
        <Link href={user ? "/verify-email" : "/login"} className="btn btn-primary btn-lg w-full mt-6">
          {user ? "Send me a new link" : "Sign in"}
        </Link>
      </AuthFrame>
    );
  }
  const user = await currentUser();
  if (!user) redirect("/login");
  if (!mustConfirmEmail(user)) redirect(await landingAfterSignIn(user));
  return (
    <AuthFrame title="Confirm your email" lead="One step before you start.">
      <FormError message={sp.error} />
      <p className="text-[0.95rem] text-ink-muted">
        We sent a link to <strong className="text-ink break-all">{user.email}</strong>. Open it to confirm the address is yours. It works for one day.
      </p>
      {sp.sent && (
        <p role="status" className="text-sm text-ok bg-ok-soft border border-[var(--ok)]/30 rounded-[var(--radius-sm)] px-3 py-2.5 mt-4">
          Sent again. Give it a minute, and look in the spam folder too.
        </p>
      )}
      <form action={resendVerificationAction} className="mt-6">
        <button className="btn btn-primary btn-lg w-full">Send the link again</button>
      </form>
      <p className="text-sm text-ink-muted mt-5">Wrong address? Sign out and create the account again with the right one.</p>
      <form action={logoutAction} className="mt-2.5">
        <button className="btn w-full">Sign out</button>
      </form>
    </AuthFrame>
  );
}
