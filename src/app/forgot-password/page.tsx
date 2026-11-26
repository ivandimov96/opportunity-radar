import type { Metadata } from "next";
import Link from "next/link";
import { requestResetAction } from "@/app/auth-actions";
import { AuthFrame, FormError } from "@/components/auth-frame";
import { accountEmailsOn } from "@/lib/auth/reset";
import { operator } from "@/lib/legal";

export const metadata: Metadata = { title: "Forgot your password?" };

/** Asks for the account's address and sends it a link to choose a new password. The answer is the same whether or not the address has an account. */
export default async function ForgotPasswordPage({ searchParams }: { searchParams: Promise<{ sent?: string; email?: string; error?: string }> }) {
  const sp = await searchParams;
  const back = (
    <>
      Remembered it? <Link href="/login">Sign in</Link>
    </>
  );
  if (!accountEmailsOn()) {
    // Nothing is sent until the operator switches account emails on: say so, and whom to write to.
    const { email } = await operator();
    return (
      <AuthFrame title="Forgot your password?" lead="We will help you back in." footer={back}>
        <p className="text-[0.95rem] text-ink-muted">
          Passwords are reset by hand for now. {email ? (
            <>
              Write to <a href={`mailto:${email}`}>{email}</a> from the address of your account and we will send you a way back in.
            </>
          ) : (
            "Write to us from the address of your account and we will send you a way back in."
          )}
        </p>
        <p className="text-[0.95rem] text-ink-muted mt-3">If you signed up with Google or Microsoft, use that button on the sign-in page: there is no password to reset.</p>
      </AuthFrame>
    );
  }
  if (sp.sent) {
    return (
      <AuthFrame title="Check your email" lead="A link is on its way." footer={back}>
        <p className="text-[0.95rem] text-ink-muted">
          If <strong className="text-ink">{sp.email}</strong> has an account with a password, we have sent it a link to choose a new one. It works for one hour.
        </p>
        <p className="text-[0.95rem] text-ink-muted mt-3">Nothing after a few minutes? Look in the spam folder, or check that it is the address you signed up with. If you signed up with Google or Microsoft, use that button instead.</p>
        <Link href="/forgot-password" className="btn w-full mt-6">
          Try another address
        </Link>
      </AuthFrame>
    );
  }
  return (
    <AuthFrame title="Forgot your password?" lead="Enter the email of your account and we will send you a link to choose a new one." footer={back}>
      <FormError message={sp.error} />
      <form action={requestResetAction} className="space-y-4">
        <div>
          <label className="label" htmlFor="email">
            Email
          </label>
          <input className="input" id="email" name="email" type="email" autoComplete="email" required defaultValue={sp.email ?? ""} autoFocus />
        </div>
        <button className="btn btn-primary btn-lg w-full">Send me the link</button>
      </form>
    </AuthFrame>
  );
}
