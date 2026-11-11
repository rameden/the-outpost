// A file the crew wrote, as a card in the conversation: its name, what kind of file it is, how
// big, and where it was saved. Clicking it opens the file in the viewer, the way a path in an
// answer does (App finds which folder it's in).

import { say } from "../bus.ts";
import { languageOf } from "../code.ts";
import { cx } from "../format.ts";
import { Icon } from "../components/bits.tsx";
import { isImage, kindOf, sizeText } from "../components/Files.tsx";
import { isMarkdown } from "../components/FileViewer.tsx";
import type { FileNode } from "./reducer.ts";

// What the card calls a file: "Markdown", "TypeScript"… or, for a name we don't know, its extension.
function typeOf(name: string): string {
  if (isImage(name)) return "Image";
  const lang = languageOf(name);
  if (lang) return lang.name;
  const ext = name.match(/\.([A-Za-z0-9]+)$/)?.[1];
  return ext ? ext.toUpperCase() : "File";
}

export function FileCard({ file }: { file: FileNode }) {
  const name = file.path.split("/").pop() || file.path;
  const folder = file.path.slice(0, file.path.length - name.length).replace(/\/$/, "");
  const open = () => say({ do: "open-file", path: file.path });
  return (
    <button type="button" className={cx("artifact", `fk-${kindOf(name, false)}`)} onClick={open}
      title={`Open ${file.path}`} aria-label={`Open ${name}, ${file.change === "created" ? "created" : "updated"} by ${file.who}`}>
      <span className="art-icon" aria-hidden="true"><Icon name={isImage(name) ? "image" : "file"} /></span>
      <span className="art-text">
        <span className="art-name">{name}</span>
        <span className="art-meta">
          {file.change === "created" ? "Created" : "Updated"} · {typeOf(name)} · {sizeText(file.bytes)}
          {folder && <> · <span className="art-where">{folder}</span></>}
        </span>
      </span>
      <span className="art-open">{isMarkdown(name) ? "Read" : "Open"}</span>
    </button>
  );
}
