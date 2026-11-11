// One file, opened over the page: its text with line numbers and its code coloured by language,
// or the image. "Changes" shows what's different since the last commit, old beside new.
//
// It opens from the Files tree, and from a file path in one of the crew's answers (where a line
// number, if the answer gave one, is scrolled to and marked).

import { useEffect, useMemo, useRef, useState } from "react";
import { api, errorText, treeImageUrl, treeQuery } from "../api.ts";
import { colourCode, languageOf } from "../code.ts";
import { sideBySide } from "../diff.ts";
import { cx } from "../format.ts";
import type { FilePreview } from "../types.ts";
import { Icon } from "./bits.tsx";
import { isImage, kindOf, refOf, sizeText, type FileRoot } from "./Files.tsx";

const LINE = 18.75; // one line of code, in pixels: 12.5px at 1.5 (see .file-text)

export function FileViewer({ root, rel, line, onClose, onMention }: {
  root: FileRoot; rel: string; line?: number; onClose: () => void; onMention: (path: string) => void;
}) {
  const [file, setFile] = useState<FilePreview | null>(null);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);
  const [changes, setChanges] = useState(false);
  const [diff, setDiff] = useState<{ diff: string; untracked: boolean } | null>(null);
  const body = useRef<HTMLDivElement>(null);
  const ref = refOf(root, rel, false);
  const where = treeQuery(root.link, root.path, rel);

  useEffect(() => {
    let gone = false;
    api<FilePreview>(`/api/tree/file?${where}`).then((f) => { if (!gone) setFile(f); }, (e) => { if (!gone) setError(errorText(e)); });
    const esc = (ev: KeyboardEvent) => { if (ev.key === "Escape") onClose(); };
    document.addEventListener("keydown", esc);
    return () => { gone = true; document.removeEventListener("keydown", esc); };
  }, [where, onClose]);

  const lines = file && "text" in file ? file.text.replace(/\n$/, "").split("\n") : null;
  // The code, coloured by its language (told from the file's name), where it's one we know.
  const language = lines ? languageOf(rel) : null;
  const coloured = useMemo(() => (lines ? colourCode(lines.join("\n"), rel) : null), [file, rel]); // eslint-disable-line react-hooks/exhaustive-deps
  const kind = `fk-${kindOf(rel.split("/").pop() ?? rel, false)}`;
  const marked = line && lines && line >= 1 && line <= lines.length ? line : 0;

  // Opened at a line: bring it a little below the top.
  useEffect(() => {
    if (marked && !changes && body.current) body.current.scrollTop = Math.max(0, (marked - 4) * LINE);
  }, [marked, changes, file]);

  async function showChanges(on: boolean) {
    setChanges(on);
    if (!on || diff) return;
    try { setDiff(await api<{ diff: string; untracked: boolean }>(`/api/tree/diff?${where}`)); }
    catch (e) { setError(errorText(e)); }
  }
  const rows = useMemo(() => (diff?.diff ? sideBySide(diff.diff) : []), [diff]);
  async function copy() {
    try { await navigator.clipboard.writeText(file?.abs ?? ref); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch { /* no clipboard here */ }
  }

  return (
    <>
      <div className="drawer-backdrop" onClick={onClose} />
      <div className="dialog file-view" role="dialog" aria-modal="true" aria-label={ref}>
        <header className={cx("file-head", kind)}>
          <Icon name={isImage(rel) ? "image" : "file"} />
          <b title={file?.abs}>{ref}</b>
          {file && <small>{language && coloured !== null ? `${language.name} · ` : ""}{sizeText(file.size)}{lines ? ` · ${lines.length} ${lines.length === 1 ? "line" : "lines"}` : ""}</small>}
          {lines && (
            <div className="file-tabs" role="tablist" aria-label="What to show">
              <button type="button" role="tab" aria-selected={!changes} onClick={() => showChanges(false)}>File</button>
              <button type="button" role="tab" aria-selected={changes} title="What's different since the last commit" onClick={() => showChanges(true)}>Changes</button>
            </div>
          )}
          <button type="button" className="hist-icon" aria-label="Close the file" title="Close (Esc)" onClick={onClose}>×</button>
        </header>
        <div className="file-body" ref={body}>
          {error ? <div className="form-error" role="alert">{error}</div>
            : !file ? <div className="ft-note">Loading…</div>
            : changes ? (
              !diff ? <div className="ft-note">Loading…</div>
                : !rows.length ? <div className="ft-note">{diff.untracked ? "This file is new and too large to lay out here." : "Nothing has changed in this file since the last commit."}</div>
                : (
                  <div className="file-diff" role="table" aria-label={diff.untracked ? "A new file: every line is added" : "Changes since the last commit, old beside new"}>
                    {rows.map((r, i) => r.kind === "hunk" ? <div key={i} className="fd-hunk" role="row">⋯ {r.label}</div> : (
                      <div key={i} className="fd-row" role="row">
                        <span className={cx("fd-n", r.kind === "changed" && r.left && "del")}>{r.left?.n ?? ""}</span>
                        <span className={cx("fd-t", r.kind === "changed" && (r.left ? "del" : "none"))} role="cell">{r.left?.text ?? ""}</span>
                        <span className={cx("fd-n", r.kind === "changed" && r.right && "add")}>{r.right?.n ?? ""}</span>
                        <span className={cx("fd-t", r.kind === "changed" && (r.right ? "add" : "none"))} role="cell">{r.right?.text ?? ""}</span>
                      </div>
                    ))}
                  </div>
                )
            )
            : lines ? (
              <div className="file-text">
                {marked > 0 && <div className="file-mark" style={{ top: 10 + (marked - 1) * LINE }} aria-hidden="true" />}
                <pre className="file-nums" aria-hidden="true">{lines.map((_, i) => i + 1).join("\n")}</pre>
                {coloured !== null
                  ? <pre className="file-code hljs" dangerouslySetInnerHTML={{ __html: coloured }} />
                  : <pre className="file-code">{lines.join("\n")}</pre>}
              </div>
            )
            : "image" in file ? <img className="file-image" alt={rel} src={treeImageUrl(root.link, root.path, rel)} />
            : <div className="ft-note">{"tooLarge" in file ? `This file is ${sizeText(file.size)}, too large to show here.` : "This isn't a text file, so there's nothing to show."} The crew can still read it.</div>}
        </div>
        <div className="dialog-actions">
          <button type="button" className="btn" onClick={copy} disabled={!file}>{copied ? "Copied" : "Copy path"}</button>
          <button type="button" className="btn primary" onClick={() => onMention(ref)}>Mention in message</button>
        </div>
      </div>
    </>
  );
}
