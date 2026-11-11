#!/usr/bin/env python3
"""Extract text from large inputs and split into heading-aware chunks with citable ids.

Usage:
    python3 extract_and_chunk.py <file-or-dir> [...] --out /home/claude/chunks [--max-chars 12000]

Supports: pdf, docx, pptx, xlsx/xls, csv/tsv, md, txt, html, json, log.
Writes <out>/<source-slug>__<nn>.md per chunk and <out>/INDEX.md listing
id, source, first heading and size. Cite chunks as <source-slug>#<nn>.
"""
import argparse
import csv
import json
import re
import shutil
import subprocess
import sys
from pathlib import Path

TEXT_EXT = {".md", ".txt", ".log", ".json", ".yaml", ".yml"}
HEADING_RE = re.compile(
    r"^(#{1,6}\s+\S.*"                 # markdown heading
    r"|\d+(\.\d+)*[.)]?\s+[A-Z].{0,80}"   # 1. / 6.1 numbered heading
    r"|\*\*[^*]{3,80}\*\*"              # **bold-only** line (docx via pandoc)
    r"|[A-Z][A-Z0-9 &/,'\-:]{4,80})$"     # ALL CAPS heading
)


def slug(p: Path) -> str:
    s = re.sub(r"[^A-Za-z0-9]+", "-", p.stem).strip("-").lower()
    return s[:40] or "source"


def run(cmd):
    return subprocess.run(cmd, capture_output=True, text=True, check=False).stdout


def extract(path: Path) -> str:
    ext = path.suffix.lower()
    if ext == ".pdf":
        if shutil.which("pdftotext"):
            return run(["pdftotext", "-layout", str(path), "-"])
        from pypdf import PdfReader  # fallback
        return "\n".join(pg.extract_text() or "" for pg in PdfReader(str(path)).pages)
    if ext in {".docx", ".odt", ".rtf", ".html", ".htm", ".epub"}:
        if shutil.which("pandoc"):
            return run(["pandoc", str(path), "-t", "gfm", "--wrap=none"])
        if ext == ".docx":
            import docx
            return "\n".join(p.text for p in docx.Document(str(path)).paragraphs)
    if ext == ".pptx":
        from pptx import Presentation
        out = []
        for i, slide in enumerate(Presentation(str(path)).slides, 1):
            out.append(f"## Slide {i}")
            for shp in slide.shapes:
                if shp.has_text_frame and shp.text_frame.text.strip():
                    out.append(shp.text_frame.text)
                if getattr(shp, "has_table", False) and shp.has_table:
                    for row in shp.table.rows:
                        out.append(" | ".join(c.text for c in row.cells))
            if slide.has_notes_slide:
                notes = slide.notes_slide.notes_text_frame.text.strip()
                if notes:
                    out.append(f"Speaker notes: {notes}")
        return "\n".join(out)
    if ext in {".xlsx", ".xlsm", ".xls"}:
        import pandas as pd
        out = []
        for name, df in pd.read_excel(str(path), sheet_name=None).items():
            out.append(f"## Sheet: {name} ({len(df)} rows x {len(df.columns)} cols)")
            out.append(df.head(500).to_csv(index=False))
            if len(df) > 500:
                out.append(f"[truncated: {len(df) - 500} more rows; analyse with pandas]")
        return "\n".join(out)
    if ext in {".csv", ".tsv"}:
        with open(path, newline="", encoding="utf-8", errors="replace") as f:
            rows = list(csv.reader(f, delimiter="\t" if ext == ".tsv" else ","))
        head = rows[:500]
        tail = f"\n[truncated: {len(rows) - 500} more rows; analyse with pandas]" if len(rows) > 500 else ""
        return f"## {path.name} ({len(rows)} rows)\n" + "\n".join(",".join(r) for r in head) + tail
    if ext in TEXT_EXT or ext == "":
        return path.read_text(encoding="utf-8", errors="replace")
    return path.read_text(encoding="utf-8", errors="replace")


def chunk(text: str, max_chars: int):
    """Split on headings; pack sections up to max_chars; hard-split oversize sections on paragraphs."""
    lines = text.splitlines()
    sections, cur, title = [], [], "(start)"
    for ln in lines:
        if HEADING_RE.match(ln.strip()) and cur and sum(len(x) for x in cur) > 200:
            sections.append((title, "\n".join(cur)))
            cur, title = [], ln.strip()[:100]
        elif not cur and ln.strip():
            title = ln.strip()[:100]
        cur.append(ln)
    if cur:
        sections.append((title, "\n".join(cur)))

    chunks, buf, buf_title = [], "", None
    for t, body in sections:
        pieces = [body]
        if len(body) > max_chars:
            pieces, acc = [], ""
            for para in re.split(r"\n\s*\n", body):
                if len(acc) + len(para) > max_chars and acc:
                    pieces.append(acc)
                    acc = ""
                acc += para + "\n\n"
            if acc:
                pieces.append(acc)
        for pc in pieces:
            if len(buf) + len(pc) > max_chars and buf:
                chunks.append((buf_title, buf))
                buf, buf_title = "", None
            buf_title = buf_title or t
            buf += pc + "\n"
    if buf.strip():
        chunks.append((buf_title, buf))
    return chunks


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("paths", nargs="+")
    ap.add_argument("--out", default="/home/claude/chunks")
    ap.add_argument("--max-chars", type=int, default=12000)
    a = ap.parse_args()

    files = []
    for p in map(Path, a.paths):
        files += sorted(x for x in p.rglob("*") if x.is_file()) if p.is_dir() else [p]

    out = Path(a.out)
    out.mkdir(parents=True, exist_ok=True)
    index = ["| chunk id | source | starts at | chars |", "|---|---|---|---|"]
    total = 0
    for f in files:
        try:
            text = extract(f)
        except Exception as e:  # keep going on bad files
            print(f"WARN could not extract {f}: {e}", file=sys.stderr)
            continue
        text = re.sub(r"\n{3,}", "\n\n", text)
        s = slug(f)
        parts = chunk(text, a.max_chars)
        for i, (t, body) in enumerate(parts, 1):
            cid = f"{s}#{i:02d}"
            (out / f"{s}__{i:02d}.md").write_text(f"<!-- {cid} | {f.name} -->\n{body}", encoding="utf-8")
            index.append(f"| {cid} | {f.name} | {(t or '').replace('|', '/')[:60]} | {len(body):,} |")
            total += len(body)
        print(f"{f.name}: {len(text):,} chars -> {len(parts)} chunks", file=sys.stderr)
    (out / "INDEX.md").write_text("\n".join(index) + f"\n\nTotal: {total:,} chars\n", encoding="utf-8")
    print("\n".join(index))
    print(f"\nTotal: {total:,} chars. Chunks in {out}/")


if __name__ == "__main__":
    main()
