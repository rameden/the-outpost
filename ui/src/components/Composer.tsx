// Where you write to the camp: the message box, attachments (files, folders, images, links,
// linked folders), @ mentions of crew and project files, and follow-ups to an earlier expedition.

import { memo, useEffect, useImperativeHandle, useLayoutEffect, useRef, useState, type ClipboardEvent, type DragEvent, type FormEvent, type KeyboardEvent, type Ref } from "react";
import { MessageInput, type MessageInputHandle } from "./MessageInput.tsx";
import { api, errorText, storeGet, storeRemove, storeSet } from "../api.ts";
import { COMMANDS, parseCommand, say, type Sent } from "../bus.ts";
import type { FeedStore } from "../feed/store.ts";
import type { CampState, Link, PendingAttachment, SendResult, Uploaded, JiraRef } from "../types.ts";
import { AttachmentChip } from "./AttachmentChip.tsx";
import { AttachMenu, type MenuView } from "./AttachMenu.tsx";
import { LEFT_OUT, USED, WorkIn, chosenWorkspaces, leftOut, outsideChoice, outsidePick, replyPick, useRepos, usedIn, type WorkChoice } from "./WorkIn.tsx";
import { Icon } from "./bits.tsx";
import { cx, handleOf, leadName } from "../format.ts";
import { w, cap, a as an } from "../words.ts";
import { ChatModel } from "./ChatModel.tsx";
import { tell } from "./StatusLine.tsx";
import { isZip, uploadFile as sendFile, uploadZip } from "../upload.ts";
import { noteFile } from "../notes.ts";
import { isMaeKey } from "../tickets.ts";
import { useDismiss } from "./usePopover.ts";
import { StatusStack, queueBehind } from "./StatusStack.tsx";

const MAX_FOLDER_FILES = 200;

// What the rest of the page can ask of the composer.
export type ComposerHandle = {
  setText: (text: string) => void;               // an example prompt
  send: (text: string) => Promise<Sent>;         // a request made for you (a review's "fix these"): to the working run now, else sent as a reply. What you've typed stays put.
  attachLink: (link: Link) => void;              // "Attach" on a linked folder
  mention: (path: string) => void;               // a file or folder picked in the Files flyout
  attachJira: (issue: Pick<JiraRef, "key" | "summary">) => void; // "Attach to message" on a ticket
  setReply: (expId: string, task: string) => void; // "Reply" on a finished expedition
  insert: (text: string) => void;                // a note's text, added after what's already written
  attachFiles: (files: File[]) => void;          // a note, attached as a file
  focus: () => void;
};

type MentionItem = { value: string; label: string; hint: string };
type Mention = { items: MentionItem[]; index: number; start: number };

// The @word the caret is in, if any: crew at the start of a message, project files anywhere.
function mentionToken(el: Pick<MessageInputHandle, "value" | "selectionStart">) {
  const pos = el.selectionStart;
  const before = el.value.slice(0, pos);
  const m = before.match(/(^|\s)@([\w./-]*)$/);
  if (!m) return null;
  return { query: m[2], start: pos - m[2].length - 1, atStart: before.trimStart() === "@" + m[2] };
}

// context: where a message goes when you haven't pressed Reply on a particular run. In a
// conversation it follows that conversation's latest run; on a new page it can name a project.
// folders: the linked folders that belong here (the "work in" picker shows only these).
// newWorktree: the project starts each new conversation in its own worktree.
// live: the conversation's run that's working right now. While it is, Send is a red Stop, and a
// Queue | Steer switch beside it says what Enter does: queue the message for when the run has
// finished, or steer (say it to the run straight away: the crew reads it on their next step).
// The menu on the Stop button does either once, whichever the switch is on.
export type SendContext = { replyTo?: string; project?: string; placeholder?: string; folders?: string[]; newWorktree?: boolean; live?: string;
  working?: Record<string, string>;   // a conversation working in worktrees: the branch in each repository
  without?: string[] };               // a conversation started without some of its project's folders: which

// onFolders: told which linked folders are attached to the message being written (by name).
// draftKey: where you are (a conversation, a new page in a project…). What you've typed and not
// sent is kept under it in this browser, so it's still there after a reload, or when you come back.
// hidden: on a page that isn't a conversation (Projects, Jira, the wiki) there's no message box.
// It stays in the page, out of sight, so what's attached or half-written is still there when you're back.
// (memo: it's drawn again when what it's given changes, not each time the feed gets a word.)
// The menu beside Send while an expedition works: queue what you've typed (as Enter does), or say it to the crew now.
const SEND_OPTIONS = [
  { label: "Queue", now: false, get title() { return `It goes once the ${w("expedition")} has finished`; } },
  { label: "Send now", now: true, get title() { return `The ${w("crew")} reads it on their next step, without waiting for the ${w("expedition")} to finish`; } },
];

export const Composer = memo(function Composer({ S, store, refresh, patch, ref, context, onSent, onFolders, draftKey, hidden }: {
  hidden?: boolean;
  S: CampState | null; store: FeedStore; refresh: () => void; patch: (fn: (s: CampState) => CampState) => void; ref: Ref<ComposerHandle>;
  context?: SendContext; onSent?: (r: SendResult) => void; onFolders?: (names: string[]) => void; draftKey?: string;
}) {
  const [text, setText] = useState("");
  const [pending, setPending] = useState<PendingAttachment[]>([]);
  const [error, setError] = useState("");
  const [menu, setMenu] = useState<MenuView | null>(null);
  const [mention, setMention] = useState<Mention | null>(null);
  const [reply, setReply] = useState<{ id: string; task: string } | null>(null);
  // "Reply" names a run in the conversation you pressed it in. Going anywhere else lets go of
  // it, so a message written in another conversation can't be sent to that one.
  const [repliedAt, setRepliedAt] = useState(draftKey);
  if (repliedAt !== draftKey) { setRepliedAt(draftKey); setReply(null); }
  // One send at a time: a second Enter while the first is still on its way would start two runs.
  const sendingNow = useRef(false);
  const [sending, setSending] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [workChoice, setWorkChoice] = useState<WorkChoice>({});
  // Outside a project: the model picked for this conversation (undefined: not touched; null: back to their own).
  const [chatModel, setChatModel] = useState<string | null | undefined>(undefined);
  // A new chat starts on the model you used last (kept in this browser), until you pick another.
  const pickChatModel = (m: string | null) => { setChatModel(m); if (m) storeSet("camp-chat-model", m); else storeRemove("camp-chat-model"); };
  // Outside a project (General, or no project at all) a conversation gets no linked folder unless
  // one is picked or attached, so there the picker is opt-in: every folder starts as not used.
  const optIn = !context?.folders;
  // Whether this is a follow-up, which stays where its conversation was working.
  const follows = reply?.id ?? context?.replyTo;
  const followsUp = !!follows;
  // A pick made on one kind of page means nothing on another: "use" in a project, "leave out" outside
  // one. A follow-up's only picks are a folder taken out of its conversation, or brought into it.
  const picks: WorkChoice = Object.fromEntries(Object.entries(workChoice).filter(([, v]) => (followsUp ? v === LEFT_OUT || v === USED : v !== (optIn ? LEFT_OUT : USED))));
  // A chained request: it waits for this run to finish before it starts.
  const [after, setAfter] = useState<{ id: string; name: string } | null>(null);
  const [afterOpen, setAfterOpen] = useState(false);
  const inFlight = [...(S?.running ?? []), ...(S?.queued ?? [])];
  const afterLive = after && inFlight.some((w) => w.id === after.id) ? after : null; // it finished meanwhile: nothing to wait for
  // This conversation's run is working: Send talks to it, unless you've pressed Reply on another run or chained this one.
  const live = !reply && !afterLive && context?.live && (S?.running ?? []).some((w) => w.id === context.live) ? context.live : null;
  const [queueOpen, setQueueOpen] = useState(false);
  const queueMenu = useRef<HTMLDivElement>(null);
  const [stopping, setStopping] = useState<string | null>(null);
  // The menu's highlighted option: it follows the mouse and the arrow keys, and starts on what Enter does (Queue or Steer, below).
  const [pickAt, setPickAt] = useState(0);
  const typed = !!text.trim() || pending.length > 0;
  useEffect(() => { if (!live) setQueueOpen(false); }, [live]);
  // Messages queued behind the run go one after another, each after the last: find the end of the line.
  const queueEnd = (run: string) => queueBehind(S?.queued, run).at(-1)?.id ?? run;
  // While a run works, what Enter does with what you've typed: queue it for when the run has
  // finished, or steer (say it to the crew now). It starts on queue for each run.
  const [steer, setSteer] = useState(false);
  useEffect(() => { setSteer(false); }, [live]);
  async function stopLive() {
    if (!live) return;
    setStopping(live);
    try { await api("/api/stop", { id: live }); } catch (e) { setStopping(null); setError(errorText(e)); }
  }
  useEffect(() => {
    if (!queueOpen) return;
    const at = steer ? 1 : 0;
    setPickAt(at);
    queueMenu.current?.querySelectorAll<HTMLButtonElement>("[role=menuitem]:not(:disabled)")[at]?.focus();
  }, [queueOpen]);
  useDismiss(queueOpen, () => setQueueOpen(false), queueMenu);
  const [sends, setSends] = useState(0);
  const { repos, reload: reloadRepos, switchBranch } = useRepos(S?.links); // links added or removed: look again
  // Moving to another project starts from that project's own default for where to work. So does
  // moving anywhere else (another conversation, a reply to a particular run): a pick belongs to the
  // place it was made, and mustn't follow you into a conversation it wasn't meant for.
  const projectKey = `${context?.project ?? ""}|${context?.newWorktree ? "new" : ""}|${(context?.folders ?? []).join(",")}|${draftKey ?? ""}|${reply?.id ?? ""}`;
  useEffect(() => {
    const fresh = context?.newWorktree ? "new" : "";
    const editable = repos.filter((r) => r.access === "write" && (context?.folders ?? []).includes(r.link));
    setWorkChoice(fresh ? Object.fromEntries(editable.map((r) => [r.link, fresh])) : {});
    setChatModel(undefined); // a model picked in one place doesn't follow you to another
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectKey, repos.length]);

  // The draft for where you are: picked up on arriving, kept as you type, gone once it's sent.
  const drafted = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (!draftKey) return;
    const key = `camp-draft:${draftKey}`;
    if (drafted.current !== draftKey) {
      drafted.current = draftKey;
      const saved = storeGet(key) ?? "";
      if (saved !== text) return setText(saved); // kept on the next pass, once the box holds it
    }
    if (text) storeSet(key, text.slice(0, 20_000)); else storeRemove(key);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draftKey, text]);

  const input = useRef<MessageInputHandle>(null);
  const box = useRef<HTMLDivElement>(null);
  const attachBtn = useRef<HTMLButtonElement>(null);
  const mentionBox = useRef<HTMLDivElement>(null);
  const pickFiles = useRef<HTMLInputElement>(null);
  const pickFolder = useRef<HTMLInputElement>(null);
  const pickZip = useRef<HTMLInputElement>(null); // the folder picker can't pick a file, so a zipped folder has its own
  const pickImages = useRef<HTMLInputElement>(null);
  const batch = useRef<string | undefined>(undefined); // one upload folder per message
  const nextKey = useRef(0);
  const select = useRef<[number, number] | null>(null); // a selection to apply once the new text is in the box
  const mentionTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const pendingNow = useRef(pending);
  pendingNow.current = pending;

  const focus = () => input.current?.focus();

  // Once new text is in the box, put the cursor where whoever changed it asked. (The box grows
  // with the message by itself, up to a point: see .mi in the stylesheet.)
  useLayoutEffect(() => {
    if (select.current) { input.current?.setSelectionRange(...select.current); select.current = null; }
  }, [text]);

  // ---------- Attachments ----------
  const update = (key: number, change: Partial<PendingAttachment>) => setPending((list) => list.map((a) => (a.key === key ? { ...a, ...change } : a)));
  const add = (a: Omit<PendingAttachment, "key">) => { const key = nextKey.current++; setPending((list) => [...list, { ...a, key }]); return key; };

  async function uploadFile(file: File, relPath?: string) {
    const r = await sendFile(file, batch.current, relPath);
    batch.current = r.batch;
    return r;
  }

  async function addFiles(files: File[]) {
    setError("");
    for (const f of files) {
      if (isZip(f)) { await addZip(f); continue; } // a zip goes in as the folder it holds
      const key = add({ kind: "file", name: f.name, status: "uploading", image: (f.type || "").startsWith("image/") });
      try { const r = await uploadFile(f); update(key, { path: r.path, name: r.name, status: "ready" }); }
      catch (e) { update(key, { status: "error" }); setError(errorText(e)); }
    }
  }

  async function addFolder(fileList: FileList) {
    setError("");
    const files = [...fileList].filter((f) => !/(^|\/)(node_modules|\.git)(\/|$)|(^|\/)\.DS_Store$/.test(f.webkitRelativePath));
    if (!files.length) return;
    if (files.length > MAX_FOLDER_FILES) return setError(`That folder has ${files.length} files. Attach a folder with up to ${MAX_FOLDER_FILES}.`);
    const key = add({ kind: "folder", name: files[0].webkitRelativePath.split("/")[0], count: files.length, status: "uploading" });
    try {
      const first = await uploadFile(files[0], files[0].webkitRelativePath); // sets the batch folder
      for (const f of files.slice(1)) await uploadFile(f, f.webkitRelativePath);
      update(key, { path: first.path.split("/").slice(0, 4).join("/"), status: "ready" }); // camp/uploads/<batch>/<folder>
    } catch (e) { update(key, { status: "error" }); setError(errorText(e)); }
  }

  // A folder sent as a .zip: the camp unpacks it, and it's attached as that folder.
  async function addZip(file: File) {
    const key = add({ kind: "folder", name: file.name.replace(/\.zip$/i, ""), status: "uploading" });
    try {
      const r = await uploadZip(file, batch.current);
      batch.current = r.batch;
      update(key, { path: r.path, name: r.name, count: r.count, status: "ready" });
    } catch (e) { update(key, { status: "error" }); setError(errorText(e)); }
  }

  function addUrl(raw: string) {
    let url = raw.trim();
    if (!/^https?:\/\//i.test(url)) url = "https://" + url;
    try { new URL(url); } catch { return setError("That doesn't look like a link."); }
    add({ kind: "url", url, name: url.replace(/^https?:\/\//i, "").slice(0, 70), status: "ready" });
  }

  // The linked folders attached right now, for whoever wants to show them (the Files flyout).
  // (and, outside a project, the ones picked under "Where to work").
  const attachedLinks = pending.filter((a) => a.kind === "folder" && a.path?.startsWith("links/")).map((a) => a.path!.slice(6));
  const linkedNow = [...new Set([...attachedLinks, ...(usedIn(picks) ?? [])])].join("\n");
  useEffect(() => { onFolders?.(linkedNow ? linkedNow.split("\n") : []); }, [linkedNow]); // eslint-disable-line react-hooks/exhaustive-deps

  // A Jira ticket: the camp reads it now and keeps it with this message's uploads, so the crew
  // gets the ticket as it stood when you attached it.
  async function attachJira(issue: Pick<JiraRef, "key" | "summary">) {
    setError("");
    const key = add({ kind: "file", name: `${issue.key} · ${issue.summary}`.slice(0, 80), status: "uploading" });
    try {
      // An Outpost ticket (MAE-3) is the camp's own; any other key is Jira's.
      const r = await api<Uploaded>(isMaeKey(issue.key) ? "/api/tickets/attach" : "/api/jira/attach", { key: issue.key, batch: batch.current });
      batch.current = r.batch;
      update(key, { path: r.path, status: "ready" });
    } catch (e) { update(key, { status: "error" }); setError(errorText(e)); }
  }

  // Linked folders: attached by reference (links/<name>), nothing uploaded.
  function attachLink(link: Link) {
    if (pendingNow.current.some((a) => a.path === `links/${link.name}`)) return;
    add({ kind: "folder", name: link.name, path: `links/${link.name}`, count: link.files, status: "ready" });
  }

  async function pasteFromClipboard() {
    try {
      const files: File[] = [];
      for (const item of await navigator.clipboard.read()) {
        for (const type of item.types) {
          if (!type.startsWith("image/")) continue;
          files.push(new File([await item.getType(type)], `pasted-${Date.now()}.${type.split("/")[1]}`, { type }));
        }
      }
      if (files.length) void addFiles(files);
      else setError("There's no image on the clipboard. Copy one, then try again.");
    } catch {
      setError("Couldn't read the clipboard here. Click the message box and press ⌘V (or Ctrl+V) instead.");
    }
  }

  function onPaste(ev: ClipboardEvent<HTMLElement>) {
    const files = [...(ev.clipboardData?.files ?? [])];
    if (!files.length) return;
    ev.preventDefault();
    void addFiles(files.map((f) => (f.name && f.name !== "image.png" ? f : new File([f], `pasted-${Date.now()}.${f.type.split("/")[1] || "png"}`, { type: f.type }))));
  }

  function onDragOver(ev: DragEvent) {
    if (![...ev.dataTransfer.types].includes("Files")) return;
    ev.preventDefault();
    setDragging(true);
  }
  function onDrop(ev: DragEvent) {
    ev.preventDefault();
    setDragging(false);
    const files = [...ev.dataTransfer.files].filter((f) => f.type || f.size > 0); // dropped folders show up empty; use Folder… for those (a .zip goes in as its folder)
    if (files.length) void addFiles(files);
  }

  // ---------- The + menu ----------
  const closeMenu = () => setMenu(null);
  // The repositories this conversation can work in.
  const workRepos = context?.folders ? repos.filter((r) => context.folders!.includes(r.link)) : repos;
  // The folders that aren't git repositories: no branch to pick, but they can be used or left out too.
  const plainFolders = (optIn ? (S?.links ?? []).map((l) => l.name) : context!.folders!).filter((f) => !repos.some((r) => r.link === f) && !!S?.links.some((l) => l.name === f));
  const everyFolder = [...workRepos.map((r) => r.link), ...plainFolders];
  // What the picker shows. Outside a project that's "not used" for everything but what's been picked
  // or attached to the message; a pick of "use it" reads as the linked checkout.
  // On a follow-up it's only what this reply changes.
  const shownChoice = optIn && !followsUp ? outsideChoice(picks, everyFolder, attachedLinks) : picks;
  // A follow-up outside a project: everything its conversation doesn't already have is "not used".
  const followed = follows ? S?.history.conversations.find((c) => c.expeditions.includes(follows)) : undefined;
  const followedProject = followed && followed.project !== "general" ? S?.history.projects.find((p) => p.id === followed.project) : undefined;
  const there = followed && [...(followedProject?.links ?? []), ...(followed.links ?? []), ...Object.keys(followed.workspaces ?? {})].filter((l) => !followed.without?.includes(l));
  const notUsed = optIn && followsUp ? (there ? everyFolder.filter((l) => !there.includes(l)) : undefined) : context?.without;
  const working = context?.working ?? (optIn && followed?.workspaces ? Object.fromEntries(Object.entries(followed.workspaces).map(([l, w]) => [l, w.branch])) : undefined);
  // What goes with the next message: your pick, or (on a new chat you haven't touched) the model you used last.
  const chatModelNow = chatModel !== undefined ? chatModel : !followsUp ? storeGet("camp-chat-model") ?? undefined : undefined;
  const dropLinks = (names: string[]) => setPending((list) => list.filter((a) => !(a.kind === "folder" && names.some((n) => a.path === `links/${n}`))));
  useEffect(() => {
    const onDown = (ev: MouseEvent) => {
      const t = ev.target as Node;
      if (!box.current?.querySelector(".attach-menu")?.contains(t) && !attachBtn.current?.contains(t) && !(t as Element).closest?.(".work-in")) setMenu(null);
      if (!mentionBox.current?.contains(t) && !input.current?.el?.contains(t)) setMention(null);
      if (!(t as Element).closest?.(".after-pick")) setAfterOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, []);
  useEffect(() => {
    if (!menu) return;
    const onKey = (ev: globalThis.KeyboardEvent) => { if (ev.key === "Escape") { setMenu(null); attachBtn.current?.focus(); } };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [menu]);

  function pick(what: "files" | "folder" | "zip" | "images") {
    closeMenu();
    ({ files: pickFiles, folder: pickFolder, zip: pickZip, images: pickImages })[what].current?.click();
  }


  // Text from somewhere else on the page (a note), after what's already written, a blank line between.
  function insertText(more: string) {
    const now = input.current?.value ?? text;
    const next = now.trim() ? `${now.trimEnd()}\n\n${more}` : more;
    select.current = [next.length, next.length];
    setText(next);
    focus();
  }

  // ---------- @ autocomplete ----------
  function updateMention() {
    const el = input.current;
    const t = el && mentionToken(el);
    clearTimeout(mentionTimer.current);
    // A message that starts with / is a command for the page: offer the ones that fit.
    const typed = el ? el.value.slice(0, el.selectionStart) : "";
    if (el && /^\/[a-z]*$/.test(typed) && el.value === typed) {
      const items = COMMANDS.filter((c) => c.name.startsWith(typed.slice(1))).map((c) => ({ value: `/${c.name}`, label: `/${c.name}${c.arg ? ` ${c.arg}` : ""}`, hint: c.does }));
      closeMenu();
      return setMention(items.length ? { items, index: 0, start: 0 } : null);
    }
    if (!el || !t) return setMention(null);
    closeMenu();
    mentionTimer.current = setTimeout(async () => {
      const q = t.query.toLowerCase();
      const crew: MentionItem[] = t.atStart && !q.includes("/")
        ? (S?.characters ?? []).filter((c) => c.id.startsWith(q) || c.name.toLowerCase().startsWith(q) || handleOf(c).startsWith(q)).map((c) => ({ value: handleOf(c), label: `${c.emoji} ${c.name}`, hint: "talk directly" }))
        : [];
      let files: string[] = [];
      try { files = (await api<{ files: string[] }>(`/api/files?q=${encodeURIComponent(t.query)}`)).files; } catch { /* just the crew, then */ }
      if (mentionToken(el)?.query !== t.query) return; // typed on; a newer lookup is coming
      const items = [...crew, ...files.map((f) => ({ value: f.replace(/\/$/, ""), label: f, hint: f.endsWith("/") ? "folder" : "" }))].slice(0, 12);
      setMention(items.length ? { items, index: 0, start: t.start } : null);
    }, 90);
  }
  function pickMention(i: number) {
    const el = input.current;
    const it = mention?.items[i];
    if (!el || !mention || !it) return;
    const before = el.value.slice(0, mention.start);
    const insert = it.value.startsWith("/") ? `${it.value} ` : `@${it.value} `;
    select.current = [before.length + insert.length, before.length + insert.length];
    setText(before + insert + el.value.slice(el.selectionStart));
    setMention(null);
    focus();
  }
  // A reference to a file or folder, put where the cursor is. Names the @ form can't carry
  // (spaces, brackets) go in as a quoted path instead; the crew reads either.
  function insertRef(path: string) {
    const el = input.current;
    const now = el?.value ?? text, at = el?.selectionStart ?? now.length;
    const before = now.slice(0, at);
    const insert = (before && !/\s$/.test(before) ? " " : "") + (/^\w[\w./-]*[\w/]$/.test(path) ? `@${path}` : `\`${path}\``) + " ";
    select.current = [at + insert.length, at + insert.length];
    setText(before + insert + now.slice(el?.selectionEnd ?? at));
    setMention(null);
    focus();
  }
  useEffect(() => { mentionBox.current?.querySelector(".active")?.scrollIntoView({ block: "nearest" }); }, [mention]);
  useEffect(() => () => clearTimeout(mentionTimer.current), []);

  function onKeyDown(ev: KeyboardEvent<HTMLElement>) {
    if (mention?.items.length) {
      if (ev.key === "ArrowDown" || ev.key === "ArrowUp") {
        ev.preventDefault();
        const n = mention.items.length;
        return setMention({ ...mention, index: (mention.index + (ev.key === "ArrowDown" ? 1 : -1) + n) % n });
      }
      if (ev.key === "Enter" || ev.key === "Tab") { ev.preventDefault(); return pickMention(mention.index); }
      if (ev.key === "Escape") { ev.preventDefault(); return setMention(null); }
    }
    if (ev.key === "Enter" && !ev.shiftKey && !ev.nativeEvent.isComposing) {
      ev.preventDefault();
      // Inside a code block Enter is a new line of code. ⌘/Ctrl+Enter sends from anywhere.
      if (ev.metaKey || ev.ctrlKey || !input.current?.enterInCode()) ev.currentTarget.closest("form")?.requestSubmit();
    }
  }

  // ---------- Sending ----------
  // now: Send now, from the button's menu while a run is working. The message goes to the run straight away, instead
  // of waiting (queued) for it to finish.
  // given: a message made for you (send, on the handle), sent as it is: not what's in the box, which stays as it was.
  async function submit(ev: FormEvent | null, now = false, given?: string): Promise<Sent> {
    ev?.preventDefault();
    if (sendingNow.current) { // the last one hasn't landed yet (what you've typed since stays in the box)
      if (given !== undefined) setError("Your last message is still on its way. Try again in a moment.");
      return null;
    }
    if (given === undefined && pending.some((a) => a.status === "uploading")) { setError("Still uploading. It'll be ready in a moment."); return null; }
    const message = (given ?? text).trim();
    const attachments = given !== undefined ? [] : pending.filter((a) => a.status === "ready").map(({ kind, name, path, url }) => ({ kind, name, path, url }));
    if (!message && !attachments.length) return null;
    setError("");
    // /new, /focus, /good…: for the page itself, not the crew.
    const command = attachments.length || given !== undefined ? null : parseCommand(message);
    if (command) {
      say({ do: "command", name: command.name, arg: command.arg || undefined });
      setText("");
      setMention(null);
      return null;
    }
    // One made for you goes to this conversation as it stands: its working run, else a reply to its
    // latest. What you've set up for your own message (Reply on another run, Start after…, folders) is for that one.
    const run = given === undefined ? live : context?.live && (S?.running ?? []).some((w) => w.id === context.live) ? context.live : null;
    // Send now: say it to the run while it works.
    if (run && now) {
      if (attachments.length) { setError(`${cap(an("expedition"))} that's working can't take attachments. Queue the message instead, and it goes once the ${w("expedition")} has finished.`); return null; }
      sendingNow.current = true;
      setSending(true);
      const said = await api("/api/steer", { id: run, text: message }).then(() => true, () => false);
      sendingNow.current = false;
      setSending(false);
      if (said) {
        if (given !== undefined) return "now";
        if (draftKey) storeRemove(`camp-draft:${draftKey}`);
        setText((now) => (now.startsWith(text) ? now.slice(text.length) : now)); // keep anything typed while it was sending
        setMention(null);
        return "now";
      }
      // It finished meanwhile: send it as a reply instead.
    }
    // While the run works, a message waits its turn behind it. One for someone else (@scout …) starts their own work.
    const queue = !!live && !now && !/^@\w+/.test(message);
    const chainTo = given !== undefined ? undefined : queue && live ? queueEnd(live) : afterLive?.id;
    sendingNow.current = true;
    setSending(true);
    try {
      const r = await api<SendResult>("/api/send", given !== undefined ? { text: message, attachments, ...(context?.replyTo ? { replyTo: context.replyTo } : { project: context?.project }) } : { text: message, attachments, ...(chainTo ? { after: chainTo } : {}),
        ...(optIn && !followedProject && chatModelNow !== undefined ? { model: chatModelNow } : {}),
        ...(follows ? { replyTo: follows, use: usedIn(picks), without: leftOut(picks) } : { workspaces: chosenWorkspaces(picks), use: usedIn(picks), without: leftOut(picks), project: context?.project }) });
      onSent?.(r);
      setSends((n) => n + 1); // a new worktree shows up in the picker a moment later
      if (given === undefined) {
        if (draftKey) storeRemove(`camp-draft:${draftKey}`); // sent: it's no longer a draft, here or on a fresh page
        setWorkChoice({}); // the picks were for that request: the next one starts clean
        setChatModel(undefined); // it's the conversation's now
        setReply(null);
        setAfter(null);
        setText((now) => (now.startsWith(text) ? now.slice(text.length) : now)); // keep anything typed while it was sending
        setPending([]);
        batch.current = undefined;
        setMention(null);
      }
      if (r.after) tell(store, queue ? `Queued: it goes once the ${w("expedition")} has finished.` : `Waiting: it starts when "${afterLive?.name ?? "the other work"}" has finished.`);
      else if (r.position > 0) {
        tell(store, S?.pausedUntil
          ? `Queued (#${r.position}): it starts when your plan's limit resets`
          : `Queued (#${r.position}): ${S?.parallel ?? 3} ${w("expeditions")} are already running, so it starts when one finishes`);
      }
      refresh();
      return "sent";
    } catch (e) { setError(errorText(e)); return null; }
    finally { sendingNow.current = false; setSending(false); }
  }

  useEffect(() => {
    if (!sends) return;
    const t = setTimeout(reloadRepos, 1500);
    return () => clearTimeout(t);
  }, [sends, reloadRepos]);

  useImperativeHandle(ref, () => ({
    setText: (t) => { setText(t); focus(); },
    send: (t) => submit(null, true, t),
    attachLink: (link) => { attachLink(link); focus(); },
    mention: insertRef,
    attachJira: (issue) => { void attachJira(issue); focus(); },
    setReply: (id, task) => { setReply({ id, task }); focus(); },
    insert: insertText,
    attachFiles: (files) => { void addFiles(files); focus(); },
    focus,
  }));

  return (
    <div className={dragging ? "composer dragging" : "composer"} ref={box} hidden={hidden} onDragOver={onDragOver} onDrop={onDrop}
      onDragLeave={(ev) => { if (!ev.currentTarget.contains(ev.relatedTarget as Node | null)) setDragging(false); }}>
      <StatusStack S={S} store={store} anchor={context?.live ?? context?.replyTo} live={context?.live && (S?.running ?? []).some((w) => w.id === context.live) ? context.live : null}
        draftKey={draftKey} refresh={refresh} />
      {reply && (
        <div className="reply-bar">
          <Icon name="reply" /><span>Following up on</span><b>{reply.task || `that ${w("expedition")}`}</b>
          <button type="button" className="att-x" aria-label="Stop following up" title="Send as a new request instead" onClick={() => setReply(null)}>×</button>
        </div>
      )}
      {afterLive && (
        <div className="reply-bar">
          <Icon name="clock" /><span>Starts after</span><b>{afterLive.name}</b>
          <button type="button" className="att-x" aria-label="Don't wait: send it now" title="Send it without waiting" onClick={() => setAfter(null)}>×</button>
        </div>
      )}
      {pending.length > 0 && (
        <div className="chips">
          {pending.map((a) => <AttachmentChip key={a.key} a={a} status={a.status} onRemove={() => setPending((list) => list.filter((x) => x.key !== a.key))} />)}
        </div>
      )}
      {mention && (
        <div className="popover mention" role="listbox" aria-label={`Files and ${w("crew")}`} ref={mentionBox}>
          {mention.items.map((it, i) => (
            <button key={it.value + i} type="button" role="option" aria-selected={i === mention.index} className={i === mention.index ? "mention-item active" : "mention-item"}
              onMouseDown={(ev) => { ev.preventDefault(); pickMention(i); }}>
              <span>{it.label}</span>{it.hint && <small>{it.hint}</small>}
            </button>
          ))}
        </div>
      )}
      {menu && (
        <AttachMenu S={S} view={menu} setView={setMenu} onClose={closeMenu}
          repos={workRepos} work={shownChoice} workLocked={followsUp} workOptional workOptIn={optIn} workWithout={notUsed} workPlain={plainFolders} workWorking={working}
          onWorkAll={(v) => {
            // A reply: take out everything the conversation has, or bring back everything it's without.
            if (followsUp) return setWorkChoice(() => Object.fromEntries(everyFolder.flatMap((l) => { const kept = replyPick(v, !!notUsed?.includes(l)); return kept ? [[l, kept]] : []; })));
            // Outside a project "none" is simply nothing picked, and nothing attached.
            if (optIn) { setWorkChoice((c) => Object.fromEntries(Object.entries(c).filter(([l]) => !everyFolder.includes(l)))); return dropLinks(everyFolder); }
            setWorkChoice((c) => { const next = { ...c }; for (const l of everyFolder) { if (v) next[l] = v; else if (next[l] === "none") delete next[l]; } return next; });
          }}
          onBranch={switchBranch}
          onJira={(issue) => { void attachJira(issue); focus(); }} onConnectJira={() => say({ do: "command", name: "connectors" })}
          onWork={(link, v) => {
            // Outside a project the linked checkout has to be asked for ("use"), and "not used" is no pick at all.
            const kept = followsUp ? replyPick(v, !!notUsed?.includes(link)) : optIn ? outsidePick(v) : v;
            if (v === LEFT_OUT && (optIn || followsUp)) dropLinks([link]); // not used, so not attached to the message either
            setWorkChoice((c) => { const next = { ...c }; if (kept) next[link] = kept; else delete next[link]; return next; });
            if (everyFolder.length === 1) { closeMenu(); focus(); } // with several, you may want to set the others too
          }}
          onTalkTo={(id) => { setText((id ? `@${id} ` : "") + text.replace(/^@\w+\s*/, "")); closeMenu(); focus(); }}
          onPick={pick}
          onPaste={() => { closeMenu(); void pasteFromClipboard(); }}
          onUrl={(url) => { addUrl(url); closeMenu(); focus(); }}
          onNote={(note) => { void addFiles([noteFile(note)]); closeMenu(); focus(); }} />
      )}
      <form className="composer-box" onSubmit={(ev) => void submit(ev, !!live && steer && !/^@\w+/.test(text.trim()))}>
        <MessageInput ref={input} placeholder={live ? (steer ? `Steer: the ${w("crew")} reads it on their next step…` : "Queue a message for when they're done…") : context?.placeholder ?? `Ask the ${leadName()}…`} label={`Request for the ${w("camp")}`} value={text}
          onChange={(t) => { setText(t); updateMention(); }} onClick={updateMention} onKeyDown={onKeyDown} onPaste={onPaste} />
        {/* One row under the text: the + menu, the branch the request will work on (click for the menu's Work in panel), send. */}
        <div className="composer-bar">
          <button className="attach-btn" type="button" ref={attachBtn} aria-label="Attach files, images, or links, or pick who to talk to" aria-haspopup="menu" aria-expanded={!!menu}
            onClick={() => { setMention(null); setMenu(menu ? null : "main"); }}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M12 5v14M5 12h14" /></svg>
          </button>
          {/* A follow-up to a run that isn't in the record yet: nothing is known about its folders, so nothing is claimed. */}
          {!(optIn && followsUp && !there) && <WorkIn repos={workRepos} choice={shownChoice} setChoice={setWorkChoice} followUp={followsUp} open={menu === "work"} working={working} without={notUsed} plain={plainFolders} optIn={optIn}
            onOpen={() => { setMention(null); setMenu(menu === "work" ? null : "work"); }} />}
          {/* Outside a project you choose who answers: the model for this conversation. */}
          {optIn && S && !followedProject && <ChatModel S={S} picked={chatModelNow} standing={followed?.model} onPick={pickChatModel} />}
          {inFlight.length > 0 && (
            <span className="after-pick">
              <button type="button" className={afterLive ? "work-btn changed" : "work-btn"} aria-haspopup="menu" aria-expanded={afterOpen}
                title="Chain it: have this start only once something that's running or waiting has finished. It's told what that work did, and carries on where it worked."
                onClick={() => { setMention(null); setMenu(null); setAfterOpen((o) => !o); }}><Icon name="clock" /><span>{afterLive ? "After" : "Start after…"}</span></button>
              {afterOpen && (
                <div className="popover after-menu" role="menu" aria-label="Start after">
                  <div className="menu-label">Start this once it has finished</div>
                  {inFlight.map((w) => {
                    const name = w.task || w.label;
                    const here = w.id === context?.replyTo;
                    return (
                      <button key={w.id} type="button" role="menuitemradio" aria-checked={afterLive?.id === w.id} className="mention-item"
                        onClick={() => { setAfter({ id: w.id, name: here ? "this conversation's current run" : name }); setAfterOpen(false); focus(); }}>
                        <span>{here ? "This conversation's current run" : name}</span><small>{(S?.queued ?? []).some((q) => q.id === w.id) ? "waiting" : w.label}</small>
                      </button>
                    );
                  })}
                  {afterLive && <button type="button" role="menuitem" className="mention-item" onClick={() => { setAfter(null); setAfterOpen(false); focus(); }}><span>Don't wait: send it now</span></button>}
                </div>
              )}
            </span>
          )}
          {/* While a run works, the choice Enter makes: wait for the run to finish, or say it now. */}
          {live && (
            <span className="detail-switch send-mode" role="group" aria-label="While they work">
              {SEND_OPTIONS.map((o) => (
                <button key={o.label} type="button" aria-pressed={steer === o.now} title={o.title} onClick={() => setSteer(o.now)}>{o.now ? "Steer" : "Queue"}</button>
              ))}
            </span>
          )}
          {/* Send, at the right end of the row. While a run works the same button is a red Stop, and its
              menu queues what you've typed (as Enter does) or sends it to the run now. */}
          <span className="composer-end">
            {live ? (
              <span className="send-split stop">
                <button className="btn primary" type="button" disabled={stopping === live} onClick={stopLive}
                  title={`Stop this ${w("expedition")} and every ${w("quest")} in it`}>{stopping === live ? "Stopping…" : "Stop"}</button>
                <button className="btn primary send-more" type="button" aria-label="More ways to send" aria-haspopup="menu" aria-expanded={queueOpen} disabled={sending}
                  onClick={() => { setMention(null); setMenu(null); setAfterOpen(false); setQueueOpen((o) => !o); }}><Icon name="chevron" /></button>
              </span>
            ) : <button className="btn primary" type="submit" disabled={sending} aria-busy={sending || undefined}>Send</button>}
          </span>
          {/* Over the right end of the row, above the button. */}
          {live && queueOpen && (
            <div className="popover send-menu" role="menu" aria-label="Send" ref={queueMenu}
              onKeyDown={(ev) => {
                if (ev.key !== "ArrowDown" && ev.key !== "ArrowUp") return;
                ev.preventDefault();
                const next = (pickAt + (ev.key === "ArrowDown" ? 1 : -1) + SEND_OPTIONS.length) % SEND_OPTIONS.length;
                setPickAt(next);
                queueMenu.current?.querySelectorAll<HTMLButtonElement>("[role=menuitem]")[next]?.focus();
              }}>
              {SEND_OPTIONS.map((o, i) => (
                <button key={o.label} type="button" role="menuitem" className={cx("mention-item", typed && pickAt === i && "active")} disabled={!typed} title={o.title}
                  onMouseEnter={() => setPickAt(i)} onFocus={() => setPickAt(i)}
                  onClick={() => { setQueueOpen(false); void submit(null, o.now); focus(); }}><span>{o.label}</span></button>
              ))}
            </div>
          )}
        </div>
      </form>
      {error && <div className="form-error">{error}</div>}
      <input type="file" multiple hidden ref={pickFiles} onChange={(ev) => { void addFiles([...(ev.target.files ?? [])]); ev.target.value = ""; }} />
      <input type="file" multiple hidden ref={pickFolder} {...{ webkitdirectory: "" }} onChange={(ev) => { if (ev.target.files) void addFolder(ev.target.files); ev.target.value = ""; }} />
      <input type="file" accept=".zip,application/zip" multiple hidden ref={pickZip} onChange={(ev) => { void addFiles([...(ev.target.files ?? [])]); ev.target.value = ""; }} />
      <input type="file" accept="image/*" multiple hidden ref={pickImages} onChange={(ev) => { void addFiles([...(ev.target.files ?? [])]); ev.target.value = ""; }} />
    </div>
  );
});
