// The six crew members every camp starts with, by handle. Kept apart from crew.ts (which reads
// camp/crew.json as it loads) so the star chart can count them without loading an outpost's crew.
export const BUILT_IN = ["quartermaster", "scout", "scribe", "artificer", "warden", "wizard"] as const;
