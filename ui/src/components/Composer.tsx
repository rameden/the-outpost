// Where you write to the camp: the message box, attachments (files, folders, images, links,
// linked folders), @ mentions of crew and project files, and follow-ups to an earlier expedition.

import { useEffect, useImperativeHandle, useLayoutEffect, useRef, useState, type ClipboardEvent, type DragEvent, type FormEvent, type KeyboardEvent, type Ref } from "react";
import { api, errorText } from "../api.ts";
import type { FeedStore } from "../feed/store.ts";
import type { CampState, Link, PendingAttachment, SendResult, Snippet, Uploaded } from "../types.ts";
import { AttachmentChip } from "./AttachmentChip.tsx";
import { AttachMenu, type MenuView } from "./AttachMenu.tsx";
import { WorkIn, chosenWorkspaces, useRepos, type WorkChoice } from "./WorkIn.tsx";

const MAX_FILE = 25 * 1024 * 1024;
const MAX_FOLDER_FILES = 200;

// What the rest of the page can ask of the composer.
export type ComposerHandle = {
  setText: (text: string) => void;               // an example prompt
  attachLink: (link: Link) => void;              // "Attach" on a linked folder
  setReply: (expId: string, task: string) => void; // "Reply" on a finished expedition
  focus: () => void;
};

type MentionItem = { value: string; label: string; hint: string };
type Mention = { items: MentionItem[]; index: number; start: number };

function toBase64(file: File) {
  return new Promise<string>((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(",")[1] ?? "");
    r.onerror = () => reject(r.error);
    r.readAsDataURL(file);
  });
}

// The @word the caret is in, if any: crew at the start of a message, project files anywhere.
function mentionToken(el: HTMLTextAreaElement) {
  const pos = el.selectionStart;
  const before = el.value.slice(0, pos);
  const m = before.match(/(^|\s)@([\w./-]*)$/);
  if (!m) return null;
  return { query: m[2], start: pos - m[2].length - 1, atStart: before.trimStart() === "@" + m[2] };
}

export function Composer({ S, store, refresh, patch, ref }: {
  S: CampState | null; store: FeedStore; refresh: () => void; patch: (fn: (s: CampState) => CampState) => void; ref: Ref<ComposerHandle>;
}) {
  const [text, setText] = useState("");
  const [pending, setPending] = useState<PendingAttachment[]>([]);
  const [error, setError] = useState("");
  const [menu, setMenu] = useState<MenuView | null>(null);
  const [mention, setMention] = useState<Mention | null>(null);
  const [reply, setReply] = useState<{ id: string; task: string } | null>(null);
  const [dragging, setDragging] = useState(false);
  const [workChoice, setWorkChoice] = useState<WorkChoice>({});
  const [sends, setSends] = useState(0);
  const { repos, reload: reloadRepos } = useRepos(S?.links); // links added or removed: look again

  const input = useRef<HTMLTextAreaElement>(null);
  const box = useRef<HTMLDivElement>(null);
  const attachBtn = useRef<HTMLButtonElement>(null);
  const mentionBox = useRef<HTMLDivElement>(null);
  const pickFiles = useRef<HTMLInputElement>(null);
  const pickFolder = useRef<HTMLInputElement>(null);
  const pickImages = useRef<HTMLInputElement>(null);
  const batch = useRef<string | undefined>(undefined); // one upload folder per message
  const nextKey = useRef(0);
  const select = useRef<[number, number] | null>(null); // a selection to apply once the new text is in the box
  const mentionTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const pendingNow = useRef(pending);
  pendingNow.current = pending;

  const focus = () => input.current?.focus();

  // The box grows with the message, up to a point.
  useLayoutEffect(() => {
    const el = input.current;
    if (!el) return;
    el.style.height = "auto";
    if (text) el.style.height = Math.min(200, el.scrollHeight) + "px"; // empty: the stylesheet's own height
    if (select.current) { el.setSelectionRange(...select.current); select.current = null; }
  }, [text]);

  // ---------- Attachments ----------
  const update = (key: number, change: Partial<PendingAttachment>) => setPending((list) => list.map((a) => (a.key === key ? { ...a, ...change } : a)));
  const add = (a: Omit<PendingAttachment, "key">) => { const key = nextKey.current++; setPending((list) => [...list, { ...a, key }]); return key; };

  async function uploadFile(file: File, relPath?: string) {
    if (file.size > MAX_FILE) throw new Error(`${file.name} is over 25 MB`);
    const r = await api<Uploaded>("/api/upload", { name: file.name, data: await toBase64(file), batch: batch.current, relPath });
    batch.current = r.batch;
    return r;
  }

  async function addFiles(files: File[]) {
    setError("");
    for (const f of files) {
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

  function addUrl(raw: string) {
    let url = raw.trim();
    if (!/^https?:\/\//i.test(url)) url = "https://" + url;
    try { new URL(url); } catch { return setError("That doesn't look like a link."); }
    add({ kind: "url", url, name: url.replace(/^https?:\/\//i, "").slice(0, 70), status: "ready" });
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

  function onPaste(ev: ClipboardEvent<HTMLTextAreaElement>) {
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
    const files = [...ev.dataTransfer.files].filter((f) => f.type || f.size > 0); // dropped folders show up empty; use Folder… for those
    if (files.length) void addFiles(files);
  }

  // ---------- The + menu ----------
  const closeMenu = () => setMenu(null);
  useEffect(() => {
    const onDown = (ev: MouseEvent) => {
      const t = ev.target as Node;
      if (!box.current?.querySelector(".attach-menu")?.contains(t) && !attachBtn.current?.contains(t)) setMenu(null);
      if (!mentionBox.current?.contains(t) && t !== input.current) setMention(null);
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

  function pick(what: "files" | "folder" | "images") {
    closeMenu();
    ({ files: pickFiles, folder: pickFolder, images: pickImages })[what].current?.click();
  }

  function insertSnippet(snippet: string) {
    const next = text.trim() ? text.trimEnd() + "\n" + snippet : snippet;
    const i = next.indexOf("{");
    const j = next.indexOf("}", i);
    if (i >= 0 && j > i) select.current = [i, j + 1]; // select the {placeholder} so you can type over it
    setText(next);
    focus();
  }

  // ---------- @ autocomplete ----------
  function updateMention() {
    const el = input.current;
    const t = el && mentionToken(el);
    clearTimeout(mentionTimer.current);
    if (!el || !t) return setMention(null);
    closeMenu();
    mentionTimer.current = setTimeout(async () => {
      const q = t.query.toLowerCase();
      const crew: MentionItem[] = t.atStart && !q.includes("/")
        ? (S?.characters ?? []).filter((c) => c.id.startsWith(q) || c.name.toLowerCase().startsWith(q)).map((c) => ({ value: c.id, label: `${c.emoji} ${c.name}`, hint: "talk directly" }))
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
    const insert = `@${it.value} `;
    select.current = [before.length + insert.length, before.length + insert.length];
    setText(before + insert + el.value.slice(el.selectionStart));
    setMention(null);
    focus();
  }
  useEffect(() => { mentionBox.current?.querySelector(".active")?.scrollIntoView({ block: "nearest" }); }, [mention]);
  useEffect(() => () => clearTimeout(mentionTimer.current), []);

  function onKeyDown(ev: KeyboardEvent<HTMLTextAreaElement>) {
    if (mention?.items.length) {
      if (ev.key === "ArrowDown" || ev.key === "ArrowUp") {
        ev.preventDefault();
        const n = mention.items.length;
        return setMention({ ...mention, index: (mention.index + (ev.key === "ArrowDown" ? 1 : -1) + n) % n });
      }
      if (ev.key === "Enter" || ev.key === "Tab") { ev.preventDefault(); return pickMention(mention.index); }
      if (ev.key === "Escape") { ev.preventDefault(); return setMention(null); }
    }
    if (ev.key === "Enter" && !ev.shiftKey && !ev.nativeEvent.isComposing) { ev.preventDefault(); ev.currentTarget.form?.requestSubmit(); }
  }

  // ---------- Sending ----------
  async function submit(ev: FormEvent) {
    ev.preventDefault();
    if (pending.some((a) => a.status === "uploading")) return setError("Still uploading. It'll be ready in a moment.");
    const message = text.trim();
    const attachments = pending.filter((a) => a.status === "ready").map(({ kind, name, path, url }) => ({ kind, name, path, url }));
    if (!message && !attachments.length) return;
    setError("");
    try {
      const r = await api<SendResult>("/api/send", { text: message, attachments, ...(reply ? { replyTo: reply.id } : { workspaces: chosenWorkspaces(workChoice) }) });
      setSends((n) => n + 1); // a new worktree shows up in the picker a moment later
      setReply(null);
      setText((now) => (now.startsWith(text) ? now.slice(text.length) : now)); // keep anything typed while it was sending
      setPending([]);
      batch.current = undefined;
      setMention(null);
      if (r.position > 0) {
        store.addSys(S?.pausedUntil
          ? `Queued (#${r.position}): it starts when your plan's limit resets`
          : `Queued (#${r.position}): ${S?.parallel ?? 3} expeditions are already running, so it starts when one finishes`);
      }
      refresh();
    } catch (e) { setError(errorText(e)); }
  }

  useEffect(() => {
    if (!sends) return;
    const t = setTimeout(reloadRepos, 1500);
    return () => clearTimeout(t);
  }, [sends, reloadRepos]);

  useImperativeHandle(ref, () => ({
    setText: (t) => { setText(t); focus(); },
    attachLink: (link) => { attachLink(link); focus(); },
    setReply: (id, task) => { setReply({ id, task }); focus(); },
    focus,
  }));

  return (
    <div className={dragging ? "composer dragging" : "composer"} ref={box} onDragOver={onDragOver} onDrop={onDrop}
      onDragLeave={(ev) => { if (!ev.currentTarget.contains(ev.relatedTarget as Node | null)) setDragging(false); }}>
      {reply && (
        <div className="reply-bar">
          <span>↩ Following up on</span><b>{reply.task || "that expedition"}</b>
          <button type="button" className="att-x" aria-label="Stop following up" title="Send as a new request instead" onClick={() => setReply(null)}>×</button>
        </div>
      )}
      {pending.length > 0 && (
        <div className="chips">
          {pending.map((a) => <AttachmentChip key={a.key} a={a} status={a.status} onRemove={() => setPending((list) => list.filter((x) => x.key !== a.key))} />)}
        </div>
      )}
      {mention && (
        <div className="popover mention" role="listbox" aria-label="Files and crew" ref={mentionBox}>
          {mention.items.map((it, i) => (
            <button key={it.value + i} type="button" role="option" aria-selected={i === mention.index} className={i === mention.index ? "mention-item active" : "mention-item"}
              onMouseDown={(ev) => { ev.preventDefault(); pickMention(i); }}>
              <span>{it.label}</span>{it.hint && <small>{it.hint}</small>}
            </button>
          ))}
        </div>
      )}
      {menu && (
        <AttachMenu S={S} view={menu} setView={setMenu} text={text} onClose={closeMenu}
          onPick={pick}
          onPaste={() => { closeMenu(); void pasteFromClipboard(); }}
          onUrl={(url) => { addUrl(url); closeMenu(); focus(); }}
          onAttachLink={(link) => { attachLink(link); closeMenu(); focus(); }}
          onLinked={(link) => { attachLink(link); closeMenu(); focus(); refresh(); }}
          onInsertSnippet={insertSnippet}
          onSnippets={(fn: (list: Snippet[]) => Snippet[]) => patch((s) => ({ ...s, snippets: fn(s.snippets ?? []) }))} />
      )}
      <form onSubmit={submit}>
        <button className="attach-btn" type="button" ref={attachBtn} aria-label="Attach files, images, or links" aria-haspopup="menu" aria-expanded={!!menu}
          onClick={() => { setMention(null); setMenu(menu ? null : "main"); }}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M12 5v14M5 12h14" /></svg>
        </button>
        <textarea ref={input} rows={1} placeholder="Ask the Quartermaster…" aria-label="Request for the camp" value={text}
          onChange={(ev) => { setText(ev.target.value); updateMention(); }} onClick={updateMention} onKeyDown={onKeyDown} onPaste={onPaste} />
        <button className="btn primary" type="submit">Send</button>
      </form>
      <div className="hints">
        <span>Talk directly:</span>
        {S?.characters.slice(1).map((c) => (
          <button key={c.id} type="button" className="hint" onClick={() => { setText(`@${c.id} ` + text.replace(/^@\w+\s*/, "")); focus(); }}>@{c.id}</button>
        ))}
        {S && <span>· Enter to send, Shift+Enter for a new line</span>}
      </div>
      <WorkIn repos={repos} choice={workChoice} setChoice={setWorkChoice} followUp={!!reply} />
      {error && <div className="form-error">{error}</div>}
      <input type="file" multiple hidden ref={pickFiles} onChange={(ev) => { void addFiles([...(ev.target.files ?? [])]); ev.target.value = ""; }} />
      <input type="file" multiple hidden ref={pickFolder} {...{ webkitdirectory: "" }} onChange={(ev) => { if (ev.target.files) void addFolder(ev.target.files); ev.target.value = ""; }} />
      <input type="file" accept="image/*" multiple hidden ref={pickImages} onChange={(ev) => { void addFiles([...(ev.target.files ?? [])]); ev.target.value = ""; }} />
    </div>
  );
}
