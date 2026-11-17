// Settings' sections by name, apart from Settings.tsx so the page's main script can read a
// section off a link (or type one) without loading Settings itself, which loads when it's opened.
export const SETTINGS_SECTIONS = [
  "general", "crew", "approvals", "limits", "phone", "usage", "stats", "unasked", "jobs", "inbox", "memory", "skills", "connectors", "terminal", "models",
] as const;
export type SettingsSection = (typeof SETTINGS_SECTIONS)[number];
export const isSettingsSection = (s: string | null): s is SettingsSection => (SETTINGS_SECTIONS as readonly string[]).includes(s ?? "");
