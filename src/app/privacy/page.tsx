import type { Metadata } from "next";
import { LegalPage, type LegalSection } from "@/components/legal-page";
import { LEGAL_UPDATED, operator } from "@/lib/legal";

export const metadata: Metadata = { title: "Privacy policy" };

/** What is collected, why, who else handles it, and what a person can ask for. Written to match what the product does. */
export default async function PrivacyPage() {
  const op = await operator();
  const contact = op.email ? `Write to ${op.email}.` : "Use the contact address shown in your account.";
  const sections: LegalSection[] = [
    {
      title: "Who we are",
      body: [`Opportunity Radar is run by ${op.name}${op.address ? `, ${op.address}` : ""}. In this policy "we" means that operator and "the service" means Opportunity Radar. We are the controller of the personal data described here.`, contact],
    },
    {
      title: "Who this policy is about",
      body: [
        "Two groups of people are affected by the service, and this policy covers both:",
        ["Users: people who create an account and use the service to find and write to businesses.", "Business contacts: people who work at a business that a user researches or writes to through the service."],
      ],
    },
    {
      title: "What we collect about users",
      body: [
        [
          "Account details: your name, your email address, and a scrambled (hashed) form of your password. We never store the password itself. If you sign in with Google, we receive your name and verified email address from Google and nothing else.",
          "Sign-in records: when you last signed in, and one cookie that keeps you signed in (see Cookies).",
          "Your workspace: the searches you run, the businesses you save, the research and emails prepared for you, your edits, your settings, and the stages of your conversations.",
          "Your mailbox connection: if you connect a mailbox, what is needed to send from it and to read replies. We read only messages that answer an email sent through the service; the rest of your inbox is not stored.",
          "Technical records: basic logs of requests and errors, used to keep the service working and secure.",
        ],
        "We do not buy data about you and we do not build advertising profiles.",
      ],
    },
    {
      title: "What we collect about business contacts",
      body: [
        "To research a business, the service reads information that the business has published itself:",
        ["Its listing on public maps: name, category, address, phone number and website.", "The text of a few pages of its own website, including a public contact email address when one is published there.", "Replies the business sends to an email it received through the service."],
        "The service is built not to guess or look up private email addresses. It uses contact details a business has chosen to publish. A named person appears only when the business's own website names them.",
      ],
    },
    {
      title: "Why we use this data, and on what basis",
      body: [
        [
          "To provide the service to you (performance of our contract with you): your account, your workspace, sending and receiving on your behalf.",
          "To keep the service secure and working (our legitimate interest): sign-in limits, logs, fixing faults.",
          "To let users contact businesses about their services (the legitimate interest of the user and of us in business-to-business communication), balanced by the limits in this policy: public business contact details only, one short email at a time reviewed by a person, a clear way to opt out, and no further contact after an opt-out.",
          "To meet legal duties, where a law requires us to keep or disclose something.",
        ],
      ],
    },
    {
      title: "Who else handles the data",
      body: [
        "We use a small number of providers to run the service. They handle data on our instructions and only for the purpose named:",
        [
          "An AI model provider (Anthropic) reads the text of business websites and drafts emails. Under its terms for business customers, this data is not used to train its models.",
          "A web reading service (Firecrawl) fetches the public pages of a business's website.",
          "A search service (Serper) returns public map listings for a search.",
          "Google, when you choose to sign in with Google.",
          "Your own mailbox provider, which delivers the emails you send and holds your replies.",
          "The company that hosts the service and its database.",
        ],
        "We do not sell personal data, and we do not share it with advertisers.",
      ],
    },
    {
      title: "Cookies",
      body: ["The service sets one cookie, which keeps you signed in. It is essential for the service to work, it is not readable by scripts, and it is not used for advertising or tracking. A second short-lived cookie is set only while you sign in with Google, to protect that sign-in. We use no analytics or advertising cookies, so there is no cookie banner."],
    },
    {
      title: "How long we keep data",
      body: [
        [
          "Your account and workspace: for as long as you have an account. When you ask us to close your account, they are deleted, except what a law requires us to keep.",
          "Sign-in sessions: up to 30 days, or until you sign out.",
          "Business research: until the user removes the business or their account ends.",
          "Opt-outs: the address of a business that asked not to be contacted is kept on a do-not-contact list, so that the request keeps being respected.",
        ],
      ],
    },
    {
      title: "How we protect data",
      body: ["Passwords are stored only in hashed form. The sign-in cookie is signed so it cannot be forged. Every page and action of a workspace requires a signed-in user. Access to the systems that run the service is limited to the operator. No system is perfectly secure; if a breach affects your data we will tell you and the authorities as the law requires."],
    },
    {
      title: "Your rights",
      body: [
        "Depending on where you live, you have the right to ask us to:",
        ["tell you what data we hold about you and give you a copy;", "correct data that is wrong;", "delete your data;", "limit or stop a use of your data, including objecting to a use based on legitimate interest;", "move your data to another service."],
        `To use any of these rights, ${op.email ? `write to ${op.email}` : "contact us"}. We answer within one month. You can also complain to the data protection authority of your country.`,
      ],
    },
    {
      title: "If you received an email sent through the service",
      body: [
        "Each email is sent by a user of the service from their own mailbox, and that user decided to write to you. Replying that you do not want further contact is enough, and that address is then not written to again through the service.",
        `You can also ask us directly what data about your business is held, where it came from, and to have it removed. ${contact}`,
      ],
    },
    {
      title: "Transfers to other countries",
      body: ["Some of the providers named above process data in other countries, including the United States. Where the law requires it, we rely on the safeguards it provides for such transfers, such as standard contractual clauses."],
    },
    {
      title: "Children",
      body: ["The service is for people who run or work for a business. It is not meant for anyone under 18, and we do not knowingly collect data about children."],
    },
    {
      title: "Changes to this policy",
      body: ["When we change this policy we change the date at the top. If a change matters to how your data is used, we will tell you by email or in the service before it takes effect."],
    },
  ];
  return <LegalPage title="Privacy policy" updated={LEGAL_UPDATED} lead="This page says, in plain words, what data Opportunity Radar handles, why, who else touches it, and what you can ask us to do with it." sections={sections} />;
}
