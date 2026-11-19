/**
 * The name an email addresses the company by. A map listing is not always the
 * company's name: it may carry a branch ("Harbour Training - Leeds
 * North") or be a search phrase the owner typed in ("Forklift Training").
 * The website knows better, so:
 *  1. a branch or tagline after " - " or " | " is dropped, and so is a place
 *     added after the legal form ("Delta Fire and Security Ltd Leeds");
 *  2. when that name does not match the website's address but the site itself
 *     names a company that does, that name is used: a registered name in its
 *     text ("QV Training Ltd" on qvtraining.example) or the name in its page
 *     titles ("QVS Fire & Security" on qvsfireandsecurity.example).
 * Nothing is guessed: a name is only taken from the site's own text, and only
 * when the web address confirms it.
 */

const LEGAL_RE = /\s*,?\s*\b(Ltd\.?|Limited|LLP|PLC|LLC|Inc\.?)$/i;
const squash = (s: string) => s.toLowerCase().replace(LEGAL_RE, "").replace(/&/g, "and").replace(/[^a-z0-9]/g, "");

/** "www.qv-training.example" → "qvtraining". */
export function domainLabel(website: string | null | undefined): string {
  if (!website) return "";
  try {
    const host = new URL(/^https?:\/\//i.test(website) ? website : `https://${website}`).hostname.replace(/^www\./i, "");
    return (host.split(".")[0] ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
  } catch {
    return "";
  }
}

/** The listing name without a branch or tagline: "Harbour Training - Leeds North" → "Harbour Training". */
export function withoutBranch(name: string): string {
  const head = name.split(/\s+[-–—|]\s+/)[0]?.trim() ?? "";
  const base = head.length >= 4 ? head : name.trim();
  // "Delta Fire and Security Ltd Leeds": what follows the legal form is a place, not part of the name.
  return base.replace(/^(.+?\b(?:Ltd\.?|Limited|LLP|PLC))\s+[A-Z][\w-]+(?:\s+[A-Z][\w-]+)?$/, "$1");
}

const matchesDomain = (name: string, label: string) => {
  const n = squash(name);
  return n.length >= 4 && label.length >= 4 && (n === label || n.includes(label) || label.includes(n));
};

/**
 * Registered company names the pages state ("… Ltd", "… Limited", "… LLP"),
 * most frequent first. Navigation text often runs into the name ("Courses
 * Acme Training Ltd"), so every trailing run of words is counted and the
 * longest run that is as frequent as the most frequent one is kept.
 */
export function companyNamesOnSite(texts: string[]): string[] {
  const counts = new Map<string, number>();
  const re = /((?:(?:[A-Z][\w&'’.]*|&|and|of)\s+){1,7})(Ltd|Limited|LLP)\b/g;
  for (const text of texts) {
    for (const m of text.matchAll(re)) {
      const words = m[1].trim().split(/\s+/);
      for (let i = 0; i < words.length; i++) {
        if (!/^[A-Z]/.test(words[i])) continue; // a name does not start with "&", "and" or "of"
        const run = `${words.slice(i).join(" ")} ${m[2]}`;
        counts.set(run, (counts.get(run) ?? 0) + 1);
      }
    }
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || b[0].length - a[0].length).map(([name]) => name);
}

export function companyNameFor(listingName: string, website: string | null | undefined, pageTexts: string[] = [], pageTitles: string[] = []): string {
  const base = withoutBranch(listingName);
  const label = domainLabel(website);
  if (!label || matchesDomain(base, label)) return base;
  // Only the name the site states most often is considered, and it must cover most of the web address:
  // "Training Ltd" inside a longer name must never win because the address happens to contain "training".
  const onSite = companyNamesOnSite(pageTexts)[0];
  if (onSite) {
    const n = squash(onSite);
    if (n === label || n.includes(label) || (label.includes(n) && n.length >= 5 && n.length >= label.length * 0.6)) return onSite;
  }
  // A page title often carries the name ("QVS Fire & Security | Security Installer Leeds"): taken only when it is exactly the web address.
  for (const title of pageTitles) {
    const part = title.split(/\s+[-–—|:]\s+/).map((t) => t.trim()).find((t) => squash(t) === label);
    if (part) return part;
  }
  return base;
}
