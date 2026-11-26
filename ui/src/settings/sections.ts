// Settings' sections by name, apart from Settings.tsx so the page's main script can read a
// section off a link (or type one) without loading Settings itself, which loads when it's opened.
export const SETTINGS_SECTIONS = [
  "general", "appearance", "notifications", "devices", "crew", "approvals", "limits", "phone", "memory", "skills", "connectors", "terminal", "models", "voice",
] as const;
export type SettingsSection = (typeof SETTINGS_SECTIONS)[number];
export const isSettingsSection = (s: string | null): s is SettingsSection => (SETTINGS_SECTIONS as readonly string[]).includes(s ?? "");
