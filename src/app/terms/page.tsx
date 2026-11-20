import type { Metadata } from "next";
import { LegalPage, type LegalSection } from "@/components/legal-page";
import { LEGAL_UPDATED, operator } from "@/lib/legal";

export const metadata: Metadata = { title: "Terms of service" };

/** The agreement between the operator and a user. Written to match what the product does today. */
export default async function TermsPage() {
  const op = await operator();
  const sections: LegalSection[] = [
    { title: "The agreement", body: [`These terms are an agreement between you and ${op.name}${op.address ? `, ${op.address}` : ""} ("we"), who runs Opportunity Radar ("the service"). By creating an account you accept them, together with the Privacy policy and the Acceptable use rules. If you do not accept them, do not use the service.`] },
    { title: "What the service does", body: ["The service helps you find businesses, reads what they have published about themselves, drafts emails for you to review, sends the emails you approve from your own mailbox (or, when you switch automatic sending on, the emails that passed its checks), and keeps track of the replies.", "The service is in early access. Workspaces are opened to new accounts a few at a time, so creating an account does not by itself give you a workspace. Features may change, and we may add limits on how much can be searched, researched or sent."] },
    { title: "Your account", body: ["You must be at least 18 and able to enter into a contract. Give accurate details, keep your password to yourself, and tell us if you think someone else has used your account. You are responsible for what is done through your account."] },
    {
      title: "You are the sender",
      body: [
        "Every email sent through the service is sent by you, from your mailbox, in your name, after you approved it or under the automatic sending you switched on. Either way you are responsible for it. In particular you agree to:",
        [
          "read each email before you approve it and correct anything that is wrong, and, if you switch automatic sending on, keep reading what goes out;",
          "follow the laws on unsolicited business email that apply to you and to the people you write to (for example CAN-SPAM in the United States, and the GDPR and ePrivacy rules in Europe and the United Kingdom), including any duty to check whether a recipient may be contacted at all;",
          "identify yourself truthfully, with a real name and postal address;",
          "respect every request not to be contacted again;",
          "follow the rules of your own mailbox provider.",
        ],
        "We do not check the law of your country or of your recipients for you, and the service is not legal advice.",
      ],
    },
    { title: "What the AI writes", body: ["Research and emails are produced with the help of AI. The service checks each statement against the text it was taken from, but it can still be wrong, out of date or incomplete. Nothing it produces is a statement by us. Treat it as a draft: you decide what is sent."] },
    { title: "What belongs to whom", body: ["The service, its software and its design belong to us. What you put into it and the emails you send belong to you. You give us permission to store and process that content only as far as needed to run the service for you. Information that businesses have published about themselves stays theirs."] },
    { title: "Other services we rely on", body: ["The service uses other companies' services to search, to read web pages, to run AI models, to sign you in, and to host data, and it sends through your mailbox provider. Those services have their own terms and can change or fail; we are not responsible for them, but we will try to keep the service working when they do."] },
    { title: "Price", body: ["Creating an account is free. We have not published prices yet. We will show you the price and ask for your agreement before anything is charged, and you will never be charged for something you did not choose."] },
    { title: "Acceptable use", body: ["You may use the service only as the Acceptable use rules allow. In short: honest, relevant, business-to-business email, in small numbers, to addresses the business published itself. No bulk mailing, no bought lists, no deception."] },
    { title: "Suspending or closing an account", body: ["You can stop using the service at any time and ask us to close your account. We may suspend or close an account that breaks these terms or the Acceptable use rules, that puts the service or other people at risk, or where the law requires it. Where we reasonably can, we will tell you first and give you a chance to put things right."] },
    { title: "No guarantees", body: ["The service is provided as it is. We do not promise that it will be uninterrupted or free of errors, that the research will be complete or correct, that emails will be delivered or read, or that you will win customers by using it."] },
    { title: "Limit of our liability", body: ["As far as the law allows, we are not liable for indirect or consequential losses, lost profit, lost business or lost data, and our total liability to you for anything connected with the service is limited to the amount you paid us in the twelve months before the claim arose. Nothing in these terms limits liability that the law does not allow to be limited."] },
    { title: "If someone makes a claim because of what you did", body: ["If a third party makes a claim against us because of emails you sent or because you broke these terms or the law, you agree to cover the reasonable costs that causes us."] },
    { title: "Law and disputes", body: ["These terms are governed by the laws of the Republic of North Macedonia, and its courts have jurisdiction, unless the consumer or other mandatory law of your own country gives you rights that cannot be set aside. Please write to us first; most problems can be solved without a court."] },
    { title: "Changes to these terms", body: ["We may change these terms. When we do, we change the date at the top, and for changes that matter we tell you in advance by email or in the service. If you keep using the service after a change takes effect, you accept the new terms."] },
    { title: "Contact", body: [op.email ? `Questions about these terms: ${op.email}.` : "Questions about these terms: use the contact address shown in your account."] },
  ];
  return <LegalPage title="Terms of service" updated={LEGAL_UPDATED} lead="The rules for using Opportunity Radar: what we provide, what you are responsible for, and what happens when something goes wrong." sections={sections} />;
}
