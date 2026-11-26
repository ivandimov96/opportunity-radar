import type { Metadata } from "next";
import Link from "next/link";
import { signupAction } from "@/app/auth-actions";
import { AuthFrame, FormError, SignInButtons } from "@/components/auth-frame";
import { redirect } from "next/navigation";
import { PasswordField } from "@/components/password-field";
import { currentUser, landingAfterSignIn } from "@/lib/auth";

export const metadata: Metadata = { title: "Create your account" };

export default async function SignupPage({ searchParams }: { searchParams: Promise<{ error?: string; email?: string; name?: string }> }) {
  const sp = await searchParams;
  const user = await currentUser();
  if (user) redirect(await landingAfterSignIn(user));
  return (
    <AuthFrame
      title="Create your account"
      lead="It takes a minute. No card needed."
      footer={
        <>
          Already have an account? <Link href="/login">Sign in</Link>
        </>
      }
    >
      <FormError message={sp.error} />
      <SignInButtons verb="Sign up" />
      <form action={signupAction} className="space-y-4">
        <div>
          <label className="label" htmlFor="name">
            Your name
          </label>
          <input className="input" id="name" name="name" autoComplete="name" required minLength={2} maxLength={80} defaultValue={sp.name ?? ""} autoFocus={!sp.name} />
        </div>
        <div>
          <label className="label" htmlFor="email">
            Email
          </label>
          <input className="input" id="email" name="email" type="email" autoComplete="email" required defaultValue={sp.email ?? ""} />
        </div>
        <div>
          <label className="label" htmlFor="password">
            Password
          </label>
          <PasswordField autoComplete="new-password" minLength={8} rules />
        </div>
        <button className="btn btn-primary btn-lg w-full">Create account</button>
        <p className="text-xs text-ink-faint text-center">
          By creating an account you agree to the <Link href="/terms">Terms of service</Link>, the <Link href="/acceptable-use">Acceptable use rules</Link> and the <Link href="/privacy">Privacy policy</Link>.
        </p>
      </form>
    </AuthFrame>
  );
}
