import { w } from "../words.ts";
import type { IconName } from "../components/bits.tsx";
// Settings' sections by name, apart from Settings.tsx so the page's main script can read a
// section off a link (or type one) without loading Settings itself, which loads when it's opened.
export const SETTINGS_SECTIONS = [
  "general", "appearance", "notifications", "devices", "crew", "approvals", "limits", "phone", "memory", "skills", "connectors", "terminal", "models", "voice",
] as const;
export type SettingsSection = (typeof SETTINGS_SECTIONS)[number];
export const isSettingsSection = (s: string | null): s is SettingsSection => (SETTINGS_SECTIONS as readonly string[]).includes(s ?? "");

export type NavItem = [SettingsSection, string, IconName];
// The navigation, in groups. A label is a function where it names the outpost or a theme-pack noun.
export const settingsGroups = (): { title: string; items: NavItem[] }[] => [
  { title: w("Camp"), items: [["general", "General", "gear"], ["models", "Models", "cpu"], ["crew", `${w("Crew")}`, "users"], ["connectors", "Connectors", "plug"]] },
  { title: "Look & sound", items: [["appearance", "Appearance", "theme"], ["notifications", "Notifications", "bell"], ["voice", "Voice", "speaker"]] },
  { title: "Safety", items: [["approvals", "Approvals", "shield"], ["limits", "Limits & budget", "gauge"]] },
  { title: "Access", items: [["devices", "Devices & uploads", "link"], ["phone", "Phone", "phone"], ["terminal", "Terminal", "terminal"]] },
  { title: "Knowledge", items: [["memory", "Memory", "bookmark"], ["skills", "Skills", "bolt"]] },
];

