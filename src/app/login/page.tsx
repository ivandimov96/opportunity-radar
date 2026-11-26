import type { Metadata } from "next";
import Link from "next/link";
import { loginAction } from "@/app/auth-actions";
import { AuthFrame, FormError, SignInButtons } from "@/components/auth-frame";
import { redirect } from "next/navigation";
import { PasswordField } from "@/components/password-field";
import { currentUser, landingAfterSignIn } from "@/lib/auth";

export const metadata: Metadata = { title: "Sign in" };

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ error?: string; email?: string; next?: string }> }) {
  const sp = await searchParams;
  // Someone who really is signed in has no use for this page.
  const user = await currentUser();
  if (user) redirect(await landingAfterSignIn(user));
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
      <SignInButtons verb="Continue" />
      <form action={loginAction} className="space-y-4">
        <input type="hidden" name="next" value={sp.next ?? ""} />
        <div>
          <label className="label" htmlFor="email">
            Email
          </label>
          <input className="input" id="email" name="email" type="email" autoComplete="email" required defaultValue={sp.email ?? ""} autoFocus={!sp.email} />
        </div>
        <div>
          <div className="flex items-baseline justify-between gap-3">
            <label className="label" htmlFor="password">
              Password
            </label>
            <Link href={`/forgot-password${sp.email ? `?email=${encodeURIComponent(sp.email)}` : ""}`} className="text-xs font-medium">
              Forgot your password?
            </Link>
          </div>
          <PasswordField autoComplete="current-password" autoFocus={Boolean(sp.email)} />
        </div>
        <button className="btn btn-primary btn-lg w-full">Sign in</button>
      </form>
    </AuthFrame>
  );
}
