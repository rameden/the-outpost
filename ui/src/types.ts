// The page's data types, taken straight from the server's own code (type-only: none of the
// server's code ends up in the page). If the server changes what it sends, typecheck fails here.

export type { CampEvent, AskKind } from "../../src/events.ts";
export type { CampState, AgentDetail } from "../../src/server.ts";
export type { CalendarWeek, WeekEvent, WeekCalendars } from "../../src/gcal.ts";
export type { ModelInfo } from "../../src/agent.ts";
export type { Link } from "../../src/links.ts";
export type { Note } from "../../src/notes.ts";
export type { MaeTicket, TicketDraft, TicketFrom, TicketPriority, TicketStatus } from "../../src/tickets.ts";
export type { PickResult } from "../../src/picker.ts";
export type { GithubStatus } from "../../src/github.ts";
export type { SessionLine } from "../../src/memory.ts";
export type { RepoInfo, WorkspaceStatus } from "../../src/repos.ts";
export type { PrDraft, PrState } from "../../src/pulls.ts";
export type { TerminalInfo } from "../../src/term.ts";
export type { TermAction } from "../../src/settings.ts";
export type { MemoryPlace, MemoryLine, Proposal } from "../../src/keeping.ts";
export type { MemoryGraph, GraphNode, GraphEdge, GraphRun, Why } from "../../src/memgraph.ts";
export type { ProviderState } from "../../src/providers.ts";
export type { JiraCard, JiraDetail, JiraPull, JiraRef, JiraStatus } from "../../src/jira.ts";
export type { TreeEntry, Listing, FilePreview } from "../../src/explorer.ts";

import type { CampEvent } from "../../src/events.ts";
import type { CampState } from "../../src/server.ts";
import type { listModels } from "../../src/agent.ts";
import type { checkpointDiff, undoCheckpoint } from "../../src/checkpoints.ts";
import type { saveUpload, saveZipFolder } from "../../src/attachments.ts";

export type EventOf<T extends CampEvent["type"]> = Extract<CampEvent, { type: T }>;
export type Character = CampState["characters"][number];
export type Quest = CampState["quests"][number];
export type ModelList = Awaited<ReturnType<typeof listModels>>;
export type CheckpointDiff = ReturnType<typeof checkpointDiff>;
export type UndoResult = { ok: true } & ReturnType<typeof undoCheckpoint>;
export type Uploaded = ReturnType<typeof saveUpload>;
export type UploadedZip = ReturnType<typeof saveZipFolder>;
// The worktrees a finished expedition worked in, and where each stood when it ended.
export type Workspaces = NonNullable<EventOf<"expedition_end">["workspaces"]>;
// thread: the conversation the request landed in (a new one is named after its first run).
// after: it's a chained request, waiting for that run to finish before it starts.
export type SendResult = { ok: true; id: string; position: number; attached: number; thread: string; after?: string };
export type { History, Project, Conversation, ProjectSettings } from "../../src/conversations.ts";
import type { ProjectPageData as PageData } from "../../src/projects.ts";
import type { WorkspaceStatus as Standing } from "../../src/repos.ts";
// A project's page, as the server sends it (each worktree with where it stands now).
export type ProjectPageData = Omit<PageData, "workspaces"> & { workspaces: (Standing & { conversation: string })[] };

// A run's saved transcript (camp/agents/<id>/sessions/*.json): the messages as the API saw them.
export type TranscriptPart = { type: string; text?: string; name?: string; input?: unknown; content?: string | { type: string; text?: string }[] };
export type Transcript = { messages?: { role: string; content: string | TranscriptPart[] }[] };

// Something attached to a message: waiting in the composer, or shown on an expedition.
export type Attached = { kind: string; name: string; path?: string; url?: string; count?: number; image?: boolean };
export type PendingAttachment = Attached & { key: number; status: "uploading" | "ready" | "error" };

import type { chroniclePage } from "../../src/reports.ts";
export type ChroniclePage = NonNullable<ReturnType<typeof chroniclePage>>;
export type { PackPreview, SkillDetail, SkillFile } from "../../src/skillpacks.ts";
export type { Payoff } from "../../src/reports.ts";
export type { Brief, BriefLine } from "../../src/brief.ts";
export type { Kind, WeekScore, Offer } from "../../src/reports.ts";
export type { HomePage } from "../../src/server.ts";
export type { ThreadStats, ContextPart } from "../../src/threadstats.ts";
