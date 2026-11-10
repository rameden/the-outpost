// One attachment, as a chip: in the composer while it waits to be sent, and on its expedition.

import { thumbUrl } from "../api.ts";
import { cx, isImagePath } from "../format.ts";
import type { Attached } from "../types.ts";
import { Icon } from "./bits.tsx";

export function AttachmentChip({ a, big, status, onRemove }: { a: Attached; big?: boolean; status?: "uploading" | "ready" | "error"; onRemove?: () => void }) {
  const suffix = status === "uploading" ? " · uploading…" : status === "error" ? " · failed" : "";
  let inner;
  if (a.kind === "url") {
    inner = <><span className="att-icon"><Icon name="link" /></span><a className="att-name" href={a.url} target="_blank" rel="noopener noreferrer">{a.name || a.url}{suffix}</a></>;
  } else if (a.path && isImagePath(a.path) && a.path.startsWith("camp/uploads/")) {
    inner = <><img src={thumbUrl(a.path)} alt="" className={big ? "big" : ""} /><span className="att-name">{a.name}{suffix}</span></>;
  } else {
    const linked = (a.path ?? "").startsWith("links/");
    const label = a.kind === "folder" ? `${a.name}${a.count ? ` · ${a.count} files` : ""}${linked ? " · linked" : ""}` : a.name;
    inner = <><span className="att-icon"><Icon name={a.kind === "folder" ? "folder" : a.image ? "image" : "file"} /></span><span className="att-name" title={a.path ?? ""}>{label}{suffix}</span></>;
  }
  return (
    <span className={cx("chip-att", status)}>
      {inner}
      {onRemove && <button type="button" className="att-x" aria-label={`Remove ${a.name}`} onClick={onRemove}>×</button>}
    </span>
  );
}
