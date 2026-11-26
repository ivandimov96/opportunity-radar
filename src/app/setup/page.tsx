/**
 * The first-run setup. A new account lands here before the app opens and is taken through what the
 * app cannot work without, one short step at a time:
 *
 *   1. who is writing        (needed to send)
 *   2. what they sell        (needed to search)
 *   3. who they sell to      (needed to search)
 *   4. their mailbox         (can be left for later)
 *   5. done: the first search, or the dashboard
 *
 * The first three cannot be skipped and open in order. Every step is saved as it is left, so closing
 * the browser loses nothing. The same fields are changed later under Settings, Your details.
 */
import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { finishOnboardingAction, saveSettingsAction } from "@/app/actions";
import { logoutAction } from "@/app/auth-actions";
import { Flash, Icon } from "@/components/ui";
import { requireOwner } from "@/lib/auth";
import { getConfig } from "@/lib/config";
import { distanceText, nearestChoiceKm } from "@/lib/distance";
import { countryName, findPlace, listCountries, regionName } from "@/lib/geo/world";
import { listMailboxes } from "@/lib/mail";
import { microsoftConfigured } from "@/lib/mail/microsoft";
import { PLACE_RADIUS_KM, getSettings, type AppSettings, type TargetPlace } from "@/lib/settings";
import { MailboxForm } from "@/app/settings/mailbox-form";
import { PROFILE_STEP_SECTIONS, PROFILE_STEP_TEXT, ProfileStepFields, profileStepDone } from "@/app/settings/profile-steps";

export const metadata: Metadata = { title: "Set up your account" };

const STEPS = ["you", "offer", "audience", "mailbox", "done"] as const;
type Step = (typeof STEPS)[number];
const LABEL: Record<Step, string> = { you: "About you", offer: "What you sell", audience: "Who you sell to", mailbox: "Your mailbox", done: "Ready" };

/**
 * A first place to sell in: where the person is, from the postal address they gave in the first step. Most
 * small sellers work around where they are. Their town with the usual distance around it when the place
 * list knows it, otherwise their country.
 */
function homePlace(s: Pick<AppSettings, "addressCountry" | "addressCity" | "addressRegion">): TargetPlace[] {
  if (!s.addressCountry) return [];
  const town = findPlace(s.addressCountry, s.addressRegion || null, s.addressCity) ?? findPlace(s.addressCountry, null, s.addressCity);
  return town ? [{ country: s.addressCountry, region: (town.region ?? "").toUpperCase(), city: town.name, radiusKm: nearestChoiceKm(PLACE_RADIUS_KM.usual, s.addressCountry) }] : [{ country: s.addressCountry, region: "" }];
}

export default async function SetupPage({ searchParams }: { searchParams: Promise<{ step?: string; ok?: string; error?: string }> }) {
  const user = await requireOwner();
  const sp = await searchParams;
  const s = await getSettings();
  const done = profileStepDone(s);
  const boxes = await listMailboxes();
  const connected = boxes.filter((b) => b.enabled);
  // The first three steps are needed and open in order; the mailbox and the end come after them.
  const needed: Step[] = ["you", "offer", "audience"];
  const firstOpen = needed.findIndex((k) => !done[k as "you"]);
  const reachable = (i: number) => firstOpen === -1 || i <= firstOpen;
  const asked = STEPS.indexOf(sp.step as Step);
  const at = asked !== -1 && reachable(asked) ? asked : firstOpen === -1 ? (asked === -1 ? 3 : asked) : firstOpen;
  const step = STEPS[at];
  if (sp.step && sp.step !== step) redirect(`/setup?step=${step}`);
  const href = (k: Step) => `/setup?step=${k}`;
  const prev = at > 0 ? STEPS[at - 1] : null;
  const first = (user.name || "").split(/\s+/)[0];
  const countries = step === "audience" || step === "you" ? listCountries().map((c) => ({ code: c.code, name: c.name })).sort((x, y) => x.name.localeCompare(y.name)) : [];
  const cfg = getConfig();
  // Where they sell is most often where they are: the country named in their own postal address is offered as the first place.
  const forFields = step === "you" && !s.senderName ? { ...s, senderName: user.name } : step === "audience" && !s.targetPlaces.length ? { ...s, targetPlaces: homePlace(s) } : s;
  const places = s.targetPlaces.map((p) => (p.city ? `within ${distanceText(p.radiusKm ?? PLACE_RADIUS_KM.usual, p.country)} of ${p.city} (${countryName(p.country)})` : p.region ? `${regionName(p.country, p.region)} (${countryName(p.country)})` : countryName(p.country)));

  return (
    <main className="min-h-screen bg-[var(--bg)] px-4 py-8 sm:py-12">
      <div className="mx-auto w-full max-w-2xl">
        <div className="flex items-center justify-between gap-3 mb-8">
          <span className="flex items-center gap-2.5 font-semibold text-ink">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/icon.svg" alt="" width={28} height={28} className="rounded-md" />
            Opportunity Radar
          </span>
          <form action={logoutAction}>
            <button className="btn btn-sm btn-ghost text-ink-muted">Sign out</button>
          </form>
        </div>

        {/* Where the setup stands: "Step 2 of 5", and one bar per step with its name under it. A finished step leads back to itself. */}
        <nav className="mb-6" aria-label="Setup steps">
          <p className="text-xs font-semibold text-ink-muted mb-2">
            Step {at + 1} of {STEPS.length}
            <span className="sm:hidden font-normal"> · {LABEL[step]}</span>
          </p>
          <ol className="grid grid-cols-5 gap-1.5 sm:gap-2">
            {STEPS.map((k, i) => {
              const on = i === at;
              const past = i < at;
              const body = (
                <>
                  <span className={`block h-1.5 rounded-full ${past || on ? "bg-[var(--accent)]" : "bg-surface-3"} ${on ? "" : past ? "opacity-60" : ""}`} aria-hidden="true" />
                  <span className={`hidden sm:block mt-2 text-xs leading-tight ${on ? "font-semibold text-ink" : past ? "text-ink-muted" : "text-ink-faint"}`}>{LABEL[k]}</span>
                </>
              );
              return (
                <li key={k} aria-current={on ? "step" : undefined}>
                  {past && reachable(i) ? (
                    <Link href={href(k)} className="block hover:no-underline group" aria-label={`${LABEL[k]}, done`}>
                      {body}
                    </Link>
                  ) : (
                    <span className="block" aria-label={on ? `${LABEL[k]}, this step` : LABEL[k]}>
                      {body}
                    </span>
                  )}
                </li>
              );
            })}
          </ol>
        </nav>

        <Flash msg={sp.error} tone="bad" />

        {(step === "you" || step === "offer" || step === "audience") && (
          <form action={saveSettingsAction} id={step === "you" ? "sender" : step} className="surface">
            {/* The signature is built from these details here; writing one's own is done later, in Settings. */}
            {PROFILE_STEP_SECTIONS[step].filter((name) => name !== "signature").map((name) => (
              <input key={name} type="hidden" name="section" value={name} />
            ))}
            <input type="hidden" name="then" value={href(STEPS[at + 1])} />
            <header className="px-6 pt-6 pb-1">
              {step === "you" && <p className="text-sm font-medium text-accent-text mb-1">{first ? `Welcome, ${first}.` : "Welcome."} Three short questions and you are ready.</p>}
              <h1 className="text-2xl font-semibold">{PROFILE_STEP_TEXT[step][0]}</h1>
              <p className="text-sm text-ink-muted mt-1.5">{PROFILE_STEP_TEXT[step][1]}</p>
            </header>
            {/* The name given at sign-up is offered as the name the emails are signed with: nobody types it twice. */}
            <ProfileStepFields firstRun step={step} s={forFields} countries={countries} />
            <footer className="flex items-center justify-between gap-3 px-6 py-4 border-t border-line bg-surface-2/60 rounded-b-[var(--radius)]">
              {prev ? (
                <Link href={href(prev)} className="btn btn-ghost">
                  Back
                </Link>
              ) : (
                <span />
              )}
              <button className="btn btn-primary btn-lg">Continue</button>
            </footer>
          </form>
        )}

        {step === "mailbox" && (
          <section id="mailbox" className="surface">
            <header className="px-6 pt-6 pb-1">
              <h1 className="text-2xl font-semibold">Connect your mailbox</h1>
              <p className="text-sm text-ink-muted mt-1.5">Emails go out from your own address and replies come back to it. You can do this now or later; nothing is ever sent without it.</p>
            </header>
            <div className="px-6 py-5">
              {connected.length > 0 ? (
                <div className="rounded-xl border border-[var(--ok)] bg-ok-soft/40 px-4 py-3.5 flex items-center gap-3">
                  <span className="w-9 h-9 rounded-lg bg-ok-soft text-ok grid place-items-center shrink-0">
                    <Icon name="check" className="w-[18px] h-[18px]" />
                  </span>
                  <div className="min-w-0">
                    <div className="text-sm font-semibold break-all">{connected[0].address}</div>
                    <div className="text-xs text-ink-muted">Connected. Sending and reading both work.</div>
                  </div>
                </div>
              ) : (
                <MailboxForm microsoftReady={microsoftConfigured()} allowFake={cfg.mail.provider === "fake"} from="setup" />
              )}
            </div>
            <footer className="flex items-center justify-between gap-3 px-6 py-4 border-t border-line bg-surface-2/60 rounded-b-[var(--radius)]">
              <Link href={href("audience")} className="btn btn-ghost">
                Back
              </Link>
              <Link href={href("done")} className={connected.length ? "btn btn-primary btn-lg" : "btn"}>
                {connected.length ? "Continue" : "I will connect it later"}
              </Link>
            </footer>
          </section>
        )}

        {step === "done" && (
          <section className="surface">
            <header className="px-6 pt-7 pb-2 text-center">
              <span className="w-14 h-14 rounded-2xl bg-ok-soft text-ok grid place-items-center mx-auto">
                <Icon name="check" className="w-7 h-7" />
              </span>
              <h1 className="text-2xl font-semibold mt-4">You are set up{first ? `, ${first}` : ""}</h1>
              <p className="text-sm text-ink-muted mt-1.5">This is what the app will work from. All of it can be changed under Settings.</p>
            </header>
            <dl className="mx-6 my-5 rounded-xl border border-line divide-y divide-line text-sm">
              {(
                [
                  ["Writing as", [s.senderName, s.senderCompany].filter(Boolean).join(", ")],
                  ["You sell", s.offer],
                  ["Looking for", `${s.targetKinds.join(", ")}: ${places.join("; ")}`],
                  ["Sending from", connected[0]?.address ?? "No mailbox yet. Connect one under Settings before you send."],
                ] as const
              ).map(([k, v]) => (
                <div key={k} className="grid sm:grid-cols-[8.5rem_minmax(0,1fr)] gap-x-4 gap-y-0.5 px-4 py-3">
                  <dt className="text-ink-muted">{k}</dt>
                  <dd className="font-medium break-words">{v}</dd>
                </div>
              ))}
            </dl>
            <footer className="flex items-center justify-between gap-3 flex-wrap px-6 py-4 border-t border-line bg-surface-2/60 rounded-b-[var(--radius)]">
              <Link href={href("mailbox")} className="btn btn-ghost">
                Back
              </Link>
              <div className="flex items-center gap-2 flex-wrap">
                <form action={finishOnboardingAction}>
                  <input type="hidden" name="to" value="dashboard" />
                  <button className="btn">Go to the dashboard</button>
                </form>
                <form action={finishOnboardingAction}>
                  <input type="hidden" name="to" value="search" />
                  <button className="btn btn-primary btn-lg">
                    <Icon name="search" /> Find your first businesses
                  </button>
                </form>
              </div>
            </footer>
          </section>
        )}
      </div>
    </main>
  );
}
