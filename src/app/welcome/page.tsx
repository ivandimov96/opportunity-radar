import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { logoutAction } from "@/app/auth-actions";
import { AuthFrame } from "@/components/auth-frame";
import { currentUser } from "@/lib/auth";

export const metadata: Metadata = { title: "Welcome" };

/** Where a new account lands: it exists, but its own workspace is not open yet. */
export default async function WelcomePage() {
  const user = await currentUser();
  if (!user) redirect("/login");
  if (user.role === "owner") redirect("/");
  return (
    <AuthFrame title={`Welcome${user.name ? `, ${user.name.split(/\s+/)[0]}` : ""}`} lead="Your account is created.">
      <p className="text-[0.95rem] text-ink-muted">
        We are opening workspaces a few at a time, so each one works well. Yours is not open yet. We will write to <strong className="text-ink">{user.email}</strong> as soon as it is.
      </p>
      <form action={logoutAction} className="mt-6">
        <button className="btn w-full">Sign out</button>
      </form>
    </AuthFrame>
  );
}
