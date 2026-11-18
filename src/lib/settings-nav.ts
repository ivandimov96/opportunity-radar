/**
 * Settings is one page split into tabs. Every link or redirect to a section goes
 * through `settingsHref`, so the right tab opens with the section in view.
 */
export const SETTINGS_TABS = [
  { key: "sender", label: "You" },
  { key: "mailbox", label: "Mailbox and sending" },
  { key: "automation", label: "Automation and budgets" },
  { key: "do-not-contact", label: "Do not contact" },
  { key: "system", label: "Connections" },
] as const;
export type SettingsTab = (typeof SETTINGS_TABS)[number]["key"];

/** Section id → the tab that shows it. */
const TAB_OF: Record<string, SettingsTab> = { sender: "sender", mailbox: "mailbox", sending: "mailbox", automation: "automation", usage: "automation", "do-not-contact": "do-not-contact", removed: "do-not-contact", connections: "system", system: "system" };

export function settingsTabOf(section: string | undefined): SettingsTab {
  return TAB_OF[section ?? ""] ?? "sender";
}

export function settingsHref(section: string): string {
  const tab = settingsTabOf(section);
  return `/settings?tab=${tab}${section === tab ? "" : `#${section}`}`;
}
