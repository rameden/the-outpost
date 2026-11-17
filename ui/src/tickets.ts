// Mae tickets, as the page holds them: the camp's own tickets (camp/tickets.json), kept beside
// Jira's for work that isn't tracked there. One store for the page, reloaded whenever the camp says
// they changed (filed by the crew, or moved along as their work started or merged).

import { useSyncExternalStore } from "react";
import { api, errorText } from "./api.ts";
import type { MaeTicket, TicketDraft, TicketFrom, TicketStatus } from "./types.ts";

// showing: the ticket open over the page (or a new one being written, with what it starts with).
// drafting: a note or plan being turned into tickets (the Turn into tickets dialog).
// Both are drawn by the app, over whatever page you're on, so a note or a plan card can open them.
export type Showing = { key: string } | { fresh: TicketInput };
export type DraftAsk = { text: string; kind: "note" | "plan"; title?: string; project?: string; from?: TicketFrom };
export type TicketsState = { tickets: MaeTicket[]; loaded: boolean; error: string; showing: Showing | null; drafting: DraftAsk | null };

let state: TicketsState = { tickets: [], loaded: false, error: "", showing: null, drafting: null };
const heard = new Set<() => void>();
function set(change: Partial<TicketsState>) {
  state = { ...state, ...change };
  for (const fn of heard) fn();
}
const subscribe = (fn: () => void) => { heard.add(fn); return () => { heard.delete(fn); }; };
export const useTickets = () => useSyncExternalStore(subscribe, () => state);
export const ticketsNow = () => state;

export const STATUS_NAMES: Record<TicketStatus, string> = { todo: "To do", doing: "In progress", done: "Done" };
export const STATUS_ORDER: TicketStatus[] = ["todo", "doing", "done"];
// A Mae ticket's key (MAE-3); anything else is a Jira key.
export const isMaeKey = (key: string | undefined) => /^MAE-\d{1,7}$/i.test(String(key ?? "").trim());

export async function loadTickets() {
  try {
    const r = await api<{ tickets: MaeTicket[] }>("/api/tickets");
    set({ tickets: r.tickets, loaded: true, error: "" });
  } catch (e) {
    set({ loaded: true, error: errorText(e) });
  }
}

// What a ticket can be given or changed to. criteria: one per line, or a list; labels: comma separated, or a list.
export type TicketInput = {
  title?: string; criteria?: string | string[]; description?: string; status?: TicketStatus;
  labels?: string | string[]; priority?: string | null; project?: string | null; from?: TicketFrom;
};

type Answer = { tickets: MaeTicket[] };
async function act<T extends Answer>(body: object): Promise<T> {
  const r = await api<T>("/api/tickets", body);
  set({ tickets: r.tickets, loaded: true, error: "" });
  return r;
}
export const createTicket = async (input: TicketInput) => (await act<Answer & { ticket: MaeTicket }>({ action: "create", ...input })).ticket;
export const createTickets = async (tickets: TicketInput[], project?: string, from?: TicketFrom) =>
  (await act<Answer & { made: MaeTicket[] }>({ action: "createMany", tickets, project, from })).made;
export const updateTicket = async (key: string, input: TicketInput) => (await act<Answer & { ticket: MaeTicket }>({ action: "update", key, ...input })).ticket;
export const removeTicket = async (key: string) => { await act({ action: "remove", key }); };

// How the crew did on a ticket that's done (the camp's debrief.ts): what went well, what could have
// gone better, and the lessons it put in front of you to keep (Settings, Memory). None until it's written.
export type Debrief = { key: string; written: string; conversations: number; runs: number; asks: number; quests: number; cost: number;
  well: string[]; better: string[]; proposed: { where: string; name: string; text: string }[] };
export const loadDebrief = (key: string) => api<{ debrief: Debrief | null }>(`/api/debrief?key=${encodeURIComponent(key)}`).then((r) => r.debrief);
export const holdDebrief = (key: string) => api<{ debrief: Debrief }>("/api/debrief", { key }).then((r) => r.debrief);

export const draftTickets = (text: string, kind: "note" | "plan", title?: string, project?: string) =>
  api<{ ok: true; drafts: TicketDraft[] }>("/api/tickets/draft", { text, kind, title, project }).then((r) => r.drafts);
// The whole of a note or a plan written up as one ticket (New ticket's "Start from"): a priority and labels too.
export const draftTicket = (text: string, kind: "note" | "plan", title?: string, project?: string) =>
  api<{ ok: true; drafts: TicketDraft[] }>("/api/tickets/draft", { text, kind, title, project, one: true }).then((r) => r.drafts[0]);

// The plans approved and waiting to start (Ready to start), each with the conversation it's in. time: when it was approved.
export type PlanSource = { id: string; body: string; time: string; conversation: string; conversationTitle: string; project?: string };
export const loadPlans = () => api<{ plans: PlanSource[] }>("/api/tickets/plans").then((r) => r.plans);

// A first go at a ticket from a note or a plan, from its text alone, while the model writes a
// fuller one (and all there is, if it can't): its title, its checklist or list as the criteria,
// and the rest as the description.
const BULLET = /^\s*(?:[-*+]|\d+[.)])\s+(?:\[[ xX]\]\s+)?/;
export function roughTicket(text: string, title?: string): { title: string; criteria: string[]; description: string } {
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  const bare = (l: string) => l.replace(/^\s*#+\s*/, "").replace(BULLET, "").replace(/\*\*/g, "").trim();
  const first = lines.findIndex((l) => l.trim());
  let name = (title ?? "").trim();
  let body = lines;
  // The first line is the title when there's none given, or when it's a heading of its own ("# …",
  // "Plan: …"), which says more than a conversation's name; and it isn't said twice when it's the one given.
  const own = first >= 0 && /^\s*(#+\s|plan\s*[:—–-]\s*\S)/i.test(lines[first]) ? bare(lines[first]).replace(/^plan\s*[:—–-]\s*/i, "") : "";
  if (first >= 0 && (!name || own || bare(lines[first]).toLowerCase() === name.toLowerCase())) { name = own || name || bare(lines[first]); body = lines.slice(first + 1); }
  const checks = body.filter((l) => /^\s*[-*+]\s+\[[ xX]\]\s+/.test(l));
  const items = (checks.length ? checks : body.filter((l) => BULLET.test(l) && !/^\s{2,}/.test(l))).map(bare).filter(Boolean);
  return { title: name.length > 80 ? `${name.slice(0, 79).trimEnd()}…` : name, criteria: items.slice(0, 6), description: body.join("\n").trim() };
}

export const showTicket = (key: string) => set({ showing: { key: key.toUpperCase() } });
export const newTicket = (fresh: TicketInput = {}) => set({ showing: { fresh } });
export const closeTicket = () => set({ showing: null });
export const turnIntoTickets = (ask: DraftAsk) => set({ drafting: ask });
export const closeDrafting = () => set({ drafting: null });

// The ones made from this note or plan, so it can say it's already been filed.
export const filedFrom = (tickets: MaeTicket[], id: string) => tickets.filter((t) => t.from?.id === id);
