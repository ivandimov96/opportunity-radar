/**
 * The profile, step by step: who is writing, what they sell, who they sell to, and the finishing touches.
 * The same fields are shown in two places, so they live here once:
 *  - the first-run setup a new account goes through (`/setup`);
 *  - Settings, Your details, where they are changed later.
 * A step is a few fields inside a form the caller provides (it decides where saving leads).
 */
import type { AppSettings } from "@/lib/settings";
import { missingSenderDetails, saysEnough } from "@/lib/settings";
import { fieldLimits, PROFILE_RULES } from "@/lib/profile-rules";
import { signatureBlock, signatureLines } from "@/lib/outreach/drafts";
import { AudienceEditor } from "./audience-editor";
import { Field as FormField } from "./parts";

export const PROFILE_STEPS = ["you", "offer", "audience", "extras"] as const;
export type ProfileStep = (typeof PROFILE_STEPS)[number];

/** The question a step asks, and one line on why. */
export const PROFILE_STEP_TEXT: Record<ProfileStep, [string, string]> = {
  you: ["Who is writing?", "Your emails are signed with this. A name and a postal address are all that is needed to send."],
  offer: ["What do you sell?", "Two sentences are enough. They decide what your emails say and which businesses are worth writing to."],
  audience: ["Who do you sell to?", "Pick the kinds of business and where they are. Your searches are made from this."],
  extras: ["Finishing touches", "All optional. Each one makes your emails a little more yours."],
};
/** The cards of the settings a step saves. */
export const PROFILE_STEP_SECTIONS: Record<ProfileStep, string[]> = { you: ["sender", "signature"], offer: ["offer"], audience: ["audience"], extras: ["tone"] };

/** Whether each step has what it needs. The first three are needed; the last is optional. */
export function profileStepDone(s: AppSettings): Record<ProfileStep, boolean> {
  return {
    you: missingSenderDetails(s).length === 0,
    offer: saysEnough(s.offer) && saysEnough(s.offerResult),
    audience: s.targetKinds.length > 0 && s.targetPlaces.length > 0,
    extras: Boolean(s.bookingLink || s.proofPoints || s.voiceSamples),
  };
}

export function ProfileStepFields({ step, s, countries }: { step: ProfileStep; s: AppSettings; countries: { code: string; name: string }[] }) {
  return (
    <>
    {step === "you" && (
      <>
        <div className="grid sm:grid-cols-2 gap-x-5 gap-y-5 px-6 py-5">
          <FormField label="Your name" name="senderName" {...fieldLimits("senderName")} value={s.senderName} placeholder="First and last name" autoComplete="name" needed={!s.senderName} required />
          <FormField label="Company" name="senderCompany" {...fieldLimits("senderCompany")} value={s.senderCompany} placeholder="Your company" optional />
          <FormField wide label="Postal address" name="postalAddress" {...fieldLimits("postalAddress")} value={s.postalAddress} placeholder="Street, city, postcode, country" autoComplete="street-address" needed={!s.postalAddress} required hint="Business email must carry a real postal address in many countries. It appears under your name." />
          <FormField label="Your title" name="senderTitle" {...fieldLimits("senderTitle")} value={s.senderTitle} placeholder="Founder" optional />
          <FormField label="Website" name="senderWebsite" {...fieldLimits("senderWebsite")} value={s.senderWebsite} placeholder="yourcompany.com" optional />
        </div>
        <div id="signature" className="mx-6 mb-6 rounded-xl border border-line bg-surface-2 px-4 py-4">
          <div className="text-xs font-semibold uppercase tracking-wide text-ink-faint">How your emails end</div>
          <pre className="letter-text font-sans whitespace-pre-wrap text-ink mt-2">{signatureBlock(s)}</pre>
          {!signatureBlock(s).trim() && <p className="text-sm text-ink-muted mt-2">Fill in your name and address, and your signature appears here.</p>}
          <details className="mt-3" open={Boolean(s.signature)}>
            <summary className="disclosure text-xs text-ink-muted">Write my own signature</summary>
            {/* Editable: what is typed here is used as written. Left as it is, it follows the details above. */}
            <textarea id="signatureText" name="signature" maxLength={PROFILE_RULES.signature.max} aria-label="Your own signature" className="textarea letter-text font-sans mt-2.5" rows={4} defaultValue={signatureLines(s)} placeholder="Your name&#10;Your title, your company&#10;Your address" />
            {s.signature && (
              <button className="btn btn-sm btn-ghost mt-2" name="useDetails" value="1" title="Build the signature from your details again">
                Use my details
              </button>
            )}
          </details>
        </div>
      </>
    )}

    {step === "offer" && (
      <div className="space-y-5 px-6 py-5">
        <FormField wide rows={3} label="What do you offer?" name="offer" {...fieldLimits("offer")} value={s.offer} needed={!saysEnough(s.offer)} required placeholder="I build custom software tools and automations that take repetitive work off people's hands." />
        <FormField wide rows={2} label="What does your customer get out of it?" name="offerResult" {...fieldLimits("offerResult")} value={s.offerResult} needed={!saysEnough(s.offerResult)} required placeholder="Fewer missed calls, and bookings that no longer need a phone call." />
      </div>
    )}

    {step === "audience" && (
      <div className="px-6 py-5 space-y-6">
        <AudienceEditor initial={{ kinds: s.targetKinds, places: s.targetPlaces, sizes: s.targetSizes, needsWebsite: s.targetNeedsWebsite, needsPhone: s.targetNeedsPhone, exclude: s.excludeKinds }} countries={countries} />
        <details open={Boolean(s.fitSigns)}>
          <summary className="disclosure text-sm font-medium">Signs that a business is a good fit (optional)</summary>
          <div className="mt-3">
            <textarea className="textarea" name="fitSigns" maxLength={PROFILE_RULES.fitSigns.max} rows={3} defaultValue={s.fitSigns} aria-label="Signs that a business is a good fit" placeholder="They take bookings by phone. Their website has no way to ask for a quote." />
            <p className="text-xs text-ink-muted mt-1.5">What you would look for on their website yourself. One sign per sentence.</p>
          </div>
        </details>
      </div>
    )}

    {step === "extras" && (
      <div className="space-y-5 px-6 py-5">
        <FormField wide label="Booking link" name="bookingLink" {...fieldLimits("bookingLink")} value={s.bookingLink} optional placeholder="https://cal.com/you/intro" hint="Offered when someone asks for a call. It is the only link an email may contain." />
        <FormField wide rows={3} label="Results you can back up" name="proofPoints" {...fieldLimits("proofPoints")} value={s.proofPoints} optional placeholder="Built the booking system of a dental practice in Leeds: phone calls down by a third." hint="Only what is true. Nothing else is ever claimed about your past work." />
        <FormField wide rows={5} label="How you write" name="voiceSamples" {...fieldLimits("voiceSamples")} value={s.voiceSamples} optional hint="Paste two or three emails you wrote yourself. New emails follow your rhythm and choice of words; the content is not copied." />
      </div>
    )}
    </>
  );
}
