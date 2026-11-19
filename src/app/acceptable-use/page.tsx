import type { Metadata } from "next";
import { LegalPage, type LegalSection } from "@/components/legal-page";
import { LEGAL_UPDATED, operator } from "@/lib/legal";

export const metadata: Metadata = { title: "Acceptable use" };

/** What the service may and may not be used for. The product is built around these rules; this page makes them a promise. */
export default async function AcceptableUsePage() {
  const op = await operator();
  const sections: LegalSection[] = [
    { title: "The idea in one sentence", body: ["Use Opportunity Radar to write a small number of honest, relevant emails to businesses you could genuinely help, and never to send bulk or deceptive mail."] },
    {
      title: "What you may do",
      body: [["Write to businesses, about something relevant to their business.", "Use the contact details a business has published itself.", "Send in small numbers from your own mailbox, each email read and approved by you.", "Follow up once when there is no answer."]],
    },
    {
      title: "What you may not do",
      body: [
        [
          "Send bulk or mass email, or use the service to get around sending limits.",
          "Write to private individuals about their private lives, or to addresses that were bought, scraped from other sources, or guessed.",
          "Contact anyone who has asked not to be contacted, or remove an address from the do-not-contact list in order to write to it again.",
          "Hide or falsify who you are, your postal address, the subject of the email, or its purpose.",
          "Make claims about a business that you know are false, or that insult or threaten.",
          "Send anything unlawful, harmful, discriminatory or fraudulent, or promote illegal goods or services.",
          "Send malware, phishing, or anything meant to obtain passwords or payment details.",
          "Break the anti-spam, privacy or consumer laws that apply to you or to the people you write to, or the rules of your mailbox provider.",
          "Try to access another user's workspace, overload or probe the service, or copy or resell it.",
        ],
      ],
    },
    { title: "Opt-outs", body: ["Every email sent through the service says how to opt out. When a business replies that it does not want further contact, or its address bounces, that address goes on your do-not-contact list and the service will not write to it again. You must respect opt-outs that reach you in any other way too."] },
    { title: "What happens if these rules are broken", body: ["We may hold back emails, limit sending, suspend the account or close it, depending on how serious it is. We may also do so when a mailbox provider, a recipient or an authority reports abuse. Where we reasonably can, we will tell you what happened and why."] },
    { title: "Reporting abuse", body: [op.email ? `If you received an email through Opportunity Radar that breaks these rules, write to ${op.email} and include the email you received. We look at every report.` : "If you received an email through Opportunity Radar that breaks these rules, reply to it saying so and contact us; we look at every report."] },
  ];
  return <LegalPage title="Acceptable use" updated={LEGAL_UPDATED} lead="Opportunity Radar exists to make outreach more honest, not to make spam easier. These are the rules every user agrees to." sections={sections} />;
}
