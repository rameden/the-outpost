// What's new in the inbox: the camp's own count, or (before it has sent one) the ones not yet seen.
import type { CampState } from "./types.ts";
export const unreadCount = (S: CampState | null | undefined): number => S?.inboxCount ?? S?.inbox?.filter((m) => !m.seen).length ?? 0;
