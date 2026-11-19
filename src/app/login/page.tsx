import type { Metadata } from "next";
import Link from "next/link";
import { loginAction } from "@/app/auth-actions";
import { AuthFrame, FormError, GoogleButton } from "@/components/auth-frame";
import { PasswordField } from "@/components/password-field";

export const metadata: Metadata = { title: "Sign in" };

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ error?: string; email?: string; next?: string }> }) {
  const sp = await searchParams;
  return (
    <AuthFrame
      title="Sign in"
      lead="Welcome back."
      footer={
        <>
          No account yet? <Link href="/signup">Create one</Link>
        </>
      }
    >
      <FormError message={sp.error} />
      <GoogleButton label="Continue with Google" />
      <form action={loginAction} className="space-y-4">
        <input type="hidden" name="next" value={sp.next ?? ""} />
        <div>
          <label className="label" htmlFor="email">
            Email
          </label>
          <input className="input" id="email" name="email" type="email" autoComplete="email" required defaultValue={sp.email ?? ""} autoFocus={!sp.email} />
        </div>
        <div>
          <label className="label" htmlFor="password">
            Password
          </label>
          <PasswordField autoComplete="current-password" autoFocus={Boolean(sp.email)} />
        </div>
        <button className="btn btn-primary btn-lg w-full">Sign in</button>
      </form>
    </AuthFrame>
  );
}
