import type { Metadata } from "next";
import Link from "next/link";
import { resetPasswordAction } from "@/app/auth-actions";
import { AuthFrame, FormError } from "@/components/auth-frame";
import { PasswordField } from "@/components/password-field";
import { resetLinkValid } from "@/lib/auth/reset";

export const metadata: Metadata = { title: "Choose a new password" };

/** Where the link in the email leads: a new password, once, within the hour. */
export default async function ResetPasswordPage({ searchParams }: { searchParams: Promise<{ token?: string; error?: string }> }) {
  const sp = await searchParams;
  const token = sp.token ?? "";
  if (!(await resetLinkValid(token))) {
    return (
      <AuthFrame title="This link no longer works" lead="A link works once, and for one hour.">
        <p className="text-[0.95rem] text-ink-muted">Ask for a new one and use it straight away.</p>
        <Link href="/forgot-password" className="btn btn-primary btn-lg w-full mt-6">
          Send me a new link
        </Link>
        <Link href="/login" className="btn w-full mt-2.5">
          Back to sign in
        </Link>
      </AuthFrame>
    );
  }
  return (
    <AuthFrame title="Choose a new password" lead="You will be signed out everywhere else.">
      <FormError message={sp.error} />
      <form action={resetPasswordAction} className="space-y-4">
        <input type="hidden" name="token" value={token} />
        <div>
          <label className="label" htmlFor="password">
            New password
          </label>
          <PasswordField autoComplete="new-password" minLength={8} autoFocus rules />
        </div>
        <button className="btn btn-primary btn-lg w-full">Save and sign in</button>
      </form>
    </AuthFrame>
  );
}
