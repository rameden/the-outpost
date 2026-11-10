// The page's data types, taken straight from the server's own code (type-only: none of the
// server's code ends up in the page). If the server changes what it sends, typecheck fails here.

export type { CampEvent, AskKind } from "../../src/events.ts";
export type { CampState, AgentDetail } from "../../src/server.ts";
export type { ModelInfo } from "../../src/agent.ts";
export type { Link } from "../../src/links.ts";
export type { Snippet } from "../../src/snippets.ts";
export type { PickResult } from "../../src/picker.ts";
export type { SessionLine } from "../../src/memory.ts";
export type { RepoInfo, WorkspaceStatus } from "../../src/repos.ts";

import type { CampEvent } from "../../src/events.ts";
import type { CampState } from "../../src/server.ts";
import type { listModels } from "../../src/agent.ts";
import type { checkpointDiff, undoCheckpoint } from "../../src/checkpoints.ts";
import type { saveUpload } from "../../src/attachments.ts";

export type EventOf<T extends CampEvent["type"]> = Extract<CampEvent, { type: T }>;
export type Character = CampState["characters"][number];
export type Quest = CampState["quests"][number];
export type ModelList = Awaited<ReturnType<typeof listModels>>;
export type CheckpointDiff = ReturnType<typeof checkpointDiff>;
export type UndoResult = { ok: true } & ReturnType<typeof undoCheckpoint>;
export type Uploaded = ReturnType<typeof saveUpload>;
// The worktrees a finished expedition worked in, and where each stood when it ended.
export type Workspaces = NonNullable<EventOf<"expedition_end">["workspaces"]>;
export type SendResult = { ok: true; id: string; position: number; attached: number };

// A run's saved transcript (camp/agents/<id>/sessions/*.json): the messages as the API saw them.
export type TranscriptPart = { type: string; text?: string; name?: string; input?: unknown; content?: string | { type: string; text?: string }[] };
export type Transcript = { messages?: { role: string; content: string | TranscriptPart[] }[] };

// Something attached to a message: waiting in the composer, or shown on an expedition.
export type Attached = { kind: string; name: string; path?: string; url?: string; count?: number; image?: boolean };
export type PendingAttachment = Attached & { key: number; status: "uploading" | "ready" | "error" };
