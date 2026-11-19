import Link from "next/link";
import { Callout, Card, Flash, Icon, PageHeader, EmptyLine } from "@/components/ui";
import { openCampaign } from "@/lib/outreach/campaigns";
import { sendPreflight, spacingLabel } from "@/lib/outreach/send";
import { getSettings } from "@/lib/settings";
import { settingsHref } from "@/lib/settings-nav";
import { sendCampaignAction } from "@/app/actions";

export const metadata = { title: "Send approved emails" };

const day = (key: string) => new Date(`${key}T12:00:00`).toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric" });
const time = (iso: string) => new Date(iso).toLocaleString("en-US", { weekday: "short", hour: "numeric", minute: "2-digit" });

export default async function SendPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const sp = await searchParams;
  const campaign = await openCampaign();
  const pre = (await sendPreflight(campaign.id))!;
  const settings = await getSettings();
  const n = pre.sendable.length;
  if (n === 0 && pre.blocked.length === 0)
    return (
      <>
        <PageHeader crumbs={[{ href: "/outreach", label: "Outreach" }, { label: "Send" }]} title="Send approved emails" />
        <Flash msg={sp.error} tone="bad" />
        <section className="surface px-6 py-8 text-center">
          <h2 className="text-lg font-semibold">Nothing to send yet</h2>
          <p className="text-[0.95rem] text-ink-muted mt-1.5 max-w-xl mx-auto">{pre.problem ?? "No email is approved."} Open an email under Outreach, read it and press Approve; approved emails then appear here.</p>
          <Link href={!pre.mailbox.ok ? settingsHref("mailbox") : pre.senderMissing.length ? settingsHref("sender") : "/outreach?tab=ready"} className="btn btn-primary mt-4">
            {!pre.mailbox.ok ? "Connect a mailbox" : pre.senderMissing.length ? "Fill in your sender details" : "Go to the emails to review"}
          </Link>
        </section>
      </>
    );

  return (
    <>
      <PageHeader crumbs={[{ href: "/outreach", label: "Outreach" }, { label: "Send" }]} title="Send approved emails" subtitle="Check the summary, then send. Nothing goes out until you press the button below." />
      <Flash msg={sp.error} tone="bad" />
      <div className="grid lg:grid-cols-[minmax(0,1fr)_340px] gap-5 items-start">
        <div className="space-y-4 min-w-0">
          {pre.problem && (
            <Callout tone="warn" title="Nothing can be sent right now">
              {pre.problem}{" "}
              {!pre.mailbox.ok ? <Link href={settingsHref("mailbox")}>Connect a mailbox</Link> : pre.senderMissing.length ? <Link href={settingsHref("sender")}>Open Settings</Link> : <Link href="/outreach">Back to the list</Link>}
            </Callout>
          )}
          <Card title={`${n} email${n === 1 ? "" : "s"} will be sent`} description={pre.mailbox.address ? `From ${pre.mailbox.address}, each to one recipient.` : undefined} padded={false}>
            {n === 0 ? (
              <EmptyLine>No approved email can be sent.</EmptyLine>
            ) : (
              <ul className="divide-y divide-line">
                {pre.sendable.map(({ draft, business }) => (
                  <li key={draft.id} className="px-5 py-2.5 flex flex-wrap items-baseline gap-x-3 text-sm">
                    <Link href={`/outreach/${draft.id}`} className="font-medium">
                      {business.name}
                    </Link>
                    <span className="text-xs text-ink-muted">{business.email}</span>
                    <span className="text-xs text-ink-faint truncate">{draft.subject}</span>
                  </li>
                ))}
              </ul>
            )}
          </Card>
          {pre.blocked.length > 0 && (
            <Card title={`${pre.blocked.length} approved email${pre.blocked.length === 1 ? "" : "s"} will be held back`} description="Approved, but something changed since. They stay in the list." padded={false}>
              <ul className="divide-y divide-line">
                {pre.blocked.map(({ draft, business, reasons }) => (
                  <li key={draft.id} className="px-5 py-2.5 text-sm">
                    <Link href={`/outreach/${draft.id}`} className="font-medium">
                      {business.name}
                    </Link>
                    <div className="text-xs text-warn">{reasons.join(" ")}</div>
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </div>
        <aside className="space-y-4">
          <Card title="Summary">
            <dl className="text-sm space-y-1.5">
              <Row k="Will be sent" v={n} strong />
              <Row k="Held back" v={pre.blocked.length} />
              <Row k="Excluded by you" v={pre.counts.excluded} />
              <Row k="Not approved yet" v={pre.counts.ready + pre.counts.needsReview} />
            </dl>
            <div className="mt-3 pt-3 border-t border-line text-xs text-ink-muted space-y-1">
              <p>Checked just now for every recipient: a valid address, not on your do-not-contact list, not emailed before, no duplicate in this batch.</p>
              {pre.plan && (
                <p>
                  One at a time, about {spacingLabel(settings.sendSpacingSeconds)} apart, at most {settings.dailySendCap} a day between {settings.sendWindowStart}:00 and {settings.sendWindowEnd}:00.
                  {pre.plan.perDay.length > 1 ? ` ${pre.plan.perDay.map(([k, c]) => `${c} on ${day(k)}`).join(", ")}.` : ` First ${time(pre.plan.firstAt)}, last ${time(pre.plan.lastAt)}.`}
                </p>
              )}
              <p>Keep the app running until they are out. You can stop what has not been sent at any time.</p>
            </div>
            <form action={sendCampaignAction} className="mt-4">
              <input type="hidden" name="campaignId" value={campaign.id} />
              <button className="btn btn-primary btn-lg w-full justify-center" disabled={!pre.canSend}>
                <Icon name="mail" /> Send {n} email{n === 1 ? "" : "s"}
              </button>
            </form>
            <Link href="/outreach" className="btn btn-ghost w-full justify-center mt-2">
              Back to the list
            </Link>
          </Card>
        </aside>
      </div>
    </>
  );
}

function Row({ k, v, strong }: { k: string; v: number; strong?: boolean }) {
  return (
    <div className="flex justify-between">
      <dt className="text-ink-muted">{k}</dt>
      <dd className={`tabular-nums ${strong ? "font-semibold" : ""}`}>{v}</dd>
    </div>
  );
}
