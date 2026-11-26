import type { Metadata } from "next";
import { changePasswordAction } from "@/app/auth-actions";
import { Card, Flash, PageHeader } from "@/components/ui";
import { PasswordField } from "@/components/password-field";
import { requireOwner, signInMethod } from "@/lib/auth";

export const metadata: Metadata = { title: "Your account" };

/** The person's own account: who they are signed in as, how they sign in, and a new password. */
export default async function AccountPage({ searchParams }: { searchParams: Promise<{ ok?: string; error?: string }> }) {
  const sp = await searchParams;
  const user = await requireOwner();
  const method = await signInMethod(user.id);
  return (
    <>
      <PageHeader title="Your account" />
      <Flash msg={sp.ok} tone="ok" />
      <Flash msg={sp.error} tone="bad" />
      <div className="grid gap-5 max-w-2xl">
        <Card title="Signed in as">
          <dl className="text-sm divide-y divide-line">
            {(
              [
                ["Name", user.name || "Not given"],
                ["Email", user.email],
                ["You sign in with", method === "password" ? "Email and password" : method === "google" ? "Google" : "Microsoft"],
              ] as const
            ).map(([k, v]) => (
              <div key={k} className="grid sm:grid-cols-[9.5rem_minmax(0,1fr)] gap-x-4 gap-y-0.5 py-2.5 first:pt-0 last:pb-0">
                <dt className="text-ink-muted">{k}</dt>
                <dd className="font-medium break-all">{v}</dd>
              </div>
            ))}
          </dl>
        </Card>
        <Card title="Password" id="change-password">
          {method === "password" ? (
            <form action={changePasswordAction} className="space-y-4 max-w-sm">
              <div>
                <label className="label" htmlFor="currentPassword">
                  Current password
                </label>
                <PasswordField id="currentPassword" name="currentPassword" autoComplete="current-password" />
              </div>
              <div>
                <label className="label" htmlFor="password">
                  New password
                </label>
                <PasswordField autoComplete="new-password" minLength={8} rules />
              </div>
              <button className="btn btn-primary">Change password</button>
              <p className="text-xs text-ink-muted">You stay signed in here and are signed out on every other device.</p>
            </form>
          ) : (
            <p className="text-sm text-ink-muted">This account signs in with {method === "google" ? "Google" : "Microsoft"}, so it has no password here. Your password is the one of that account.</p>
          )}
        </Card>
      </div>
    </>
  );
}
