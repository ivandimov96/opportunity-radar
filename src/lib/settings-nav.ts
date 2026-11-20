/**
 * Settings is one page with a menu of sections on the left, each about one thing. Every link or
 * redirect to a section goes through `settingsHref`, so the right section opens.
 */
export const SETTINGS_TABS = [
  { key: "sender", label: "Your details", group: "You", icon: "building" },
  { key: "mailbox", label: "Mailbox", group: "You", icon: "mail" },
  { key: "sending", label: "Sending and follow-ups", group: "Emails", icon: "clock" },
  { key: "autopilot", label: "Automatic sending", group: "Emails", icon: "play" },
  { key: "do-not-contact", label: "Do not contact", group: "Emails", icon: "shield" },
  { key: "automation", label: "Finding and research", group: "Finding businesses", icon: "sparkles" },
  { key: "usage", label: "Plan and usage", group: "Account", icon: "database" },
  { key: "system", label: "Connections", group: "Admin", icon: "settings" },
] as const;
export type SettingsTab = (typeof SETTINGS_TABS)[number]["key"];

/** Section id → the menu entry that shows it (a few ids are parts of a section). */
const TAB_OF: Record<string, SettingsTab> = { offer: "sender", audience: "sender", tone: "sender", followups: "sending", countries: "sending", answers: "autopilot", autorules: "autopilot", research: "automation", drafting: "automation", sender: "sender", signature: "sender", mailbox: "mailbox", sending: "sending", autopilot: "autopilot", automation: "automation", usage: "usage", budget: "usage", "do-not-contact": "do-not-contact", removed: "do-not-contact", connections: "system", system: "system" };

export function settingsTabOf(section: string | undefined): SettingsTab {
  return TAB_OF[section ?? ""] ?? "sender";
}

export function settingsHref(section: string): string {
  const tab = settingsTabOf(section);
  return `/settings?tab=${tab}${section === tab ? "" : `#${section}`}`;
}
