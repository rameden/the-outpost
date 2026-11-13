// The file viewer flyout: a Markdown file is laid out to read (its source a tab away), other text
// keeps its line numbers, and a file the camp keeps itself (a crew member's output) opens too.
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { FileViewer, frontMatter, isMarkdown } from "./FileViewer.tsx";

const gets: string[] = [];
let text = "";
beforeEach(() => {
  gets.length = 0;
  vi.stubGlobal("fetch", vi.fn(async (url: string) => {
    gets.push(url);
    const path = new URL(url, "http://camp").searchParams.get("path");
    return new Response(JSON.stringify({ path, abs: `/camp/${path}`, size: text.length, text }));
  }));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

const TICKET = `---
summary: Share the whole thread
status: draft
---

# MP-745: Share entire thread

Opens the **Web Link** modal. See \`links/mi-web-app/src/share.ts:12\`.

## Acceptance criteria
- [x] Share sits in the menu
- [ ] It asks for a password

| Field | Default | Note |
| :-- | --: | :-: |
| Require password | on | ask |
| Expiration | 7 days | |
`;

test("a crew member's Markdown output opens laid out to read: headings, a checklist, a table, its front matter apart", async () => {
  text = TICKET;
  const onClose = vi.fn(), onMention = vi.fn();
  render(<FileViewer root={{ link: "@camp" }} rel="agents/scribe/outputs/MP-745-revised.md" onClose={onClose} onMention={onMention} />);
  const fly = await screen.findByRole("dialog", { name: "camp/agents/scribe/outputs/MP-745-revised.md" });
  expect(fly.className).toBe("drawer file-view");
  await waitFor(() => expect(within(fly).getByRole("heading", { level: 1 }).textContent).toBe("MP-745: Share entire thread"));
  expect(gets[0]).toBe("/api/tree/file?link=%40camp&path=agents%2Fscribe%2Foutputs%2FMP-745-revised.md");
  // Front matter is a small table of its own, not a rule and a run-on line.
  expect([...fly.querySelectorAll(".file-meta > div")].map((d) => d.textContent)).toEqual(["summaryShare the whole thread", "statusdraft"]);
  expect(within(fly).getByText("Web Link").tagName).toBe("STRONG");
  const boxes = within(fly).getAllByRole("checkbox") as HTMLInputElement[];
  expect(boxes.map((b) => [b.checked, b.disabled])).toEqual([[true, true], [false, true]]);
  const table = within(fly).getByRole("table");
  expect([...table.querySelectorAll("th")].map((c) => c.textContent)).toEqual(["Field", "Default", "Note"]);
  expect([...table.querySelectorAll("tbody tr")].map((r) => [...r.children].map((c) => c.textContent).join("="))).toEqual(["Require password=on=ask", "Expiration=7 days="]);
  expect((table.querySelectorAll("td")[2] as HTMLElement).style.textAlign).toBe("center");
  expect((table.querySelectorAll("td")[1] as HTMLElement).style.textAlign).toBe("right");
  // A path in the page is still a link to that file.
  expect(within(fly).getByRole("link", { name: "links/mi-web-app/src/share.ts:12" })).toBeTruthy();

  // Read / Source, and no Changes: the camp's own files aren't compared against a commit.
  expect(screen.getAllByRole("tab").map((t) => `${t.textContent}${t.getAttribute("aria-selected") === "true" ? " *" : ""}`)).toEqual(["Read *", "Source"]);
  fireEvent.click(screen.getByRole("tab", { name: "Source" }));
  expect(fly.querySelector(".file-code")?.textContent).toContain("| Require password | on |");
  expect(fly.querySelector(".file-page")).toBeNull();

  fireEvent.click(screen.getByRole("button", { name: "Mention in message" }));
  expect(onMention).toHaveBeenCalledWith("camp/agents/scribe/outputs/MP-745-revised.md");
  fireEvent.keyDown(document, { key: "Escape" });
  expect(onClose).toHaveBeenCalled();
});

test("sent to a line of a Markdown file, it opens on the source at that line; other files have no Read tab", async () => {
  text = "# Notes\none\ntwo\n";
  const { unmount } = render(<FileViewer root={{ link: "demo" }} rel="docs/notes.md" line={2} onClose={() => {}} onMention={() => {}} />);
  const fly = await screen.findByRole("dialog");
  await waitFor(() => expect(fly.querySelector(".file-mark")).not.toBeNull());
  expect(screen.getAllByRole("tab").map((t) => `${t.textContent}${t.getAttribute("aria-selected") === "true" ? " *" : ""}`)).toEqual(["Read", "Source *", "Changes"]);
  unmount();
  text = "export const a = 1;\n";
  render(<FileViewer root={{ link: "demo" }} rel="src/a.ts" onClose={() => {}} onMention={() => {}} />);
  await waitFor(() => expect(screen.getByRole("dialog").querySelector(".file-code")).not.toBeNull());
  expect(screen.getAllByRole("tab").map((t) => t.textContent)).toEqual(["File", "Changes"]);
});

test("what counts as Markdown, and how front matter is told from the page", () => {
  expect(["a.md", "B.MD", "c.markdown", "d.mdx", "e.txt", "md"].map(isMarkdown)).toEqual([true, true, true, true, false, false]);
  expect(frontMatter("# No front matter\n---\nnot: meta\n")).toEqual({ meta: [], body: "# No front matter\n---\nnot: meta\n" });
  expect(frontMatter('---\ntitle: "Quoted"\nempty:\n  nested: skipped\n---\nBody')).toEqual({ meta: [["title", "Quoted"]], body: "Body" });
});

test("the page around it redrawing (a new onClose each time) doesn't read the file again; Escape uses the latest one", async () => {
  text = "export const a = 1;\n";
  const viewer = (onClose = () => {}) => <FileViewer root={{ link: "demo" }} rel="src/a.ts" onClose={onClose} onMention={() => {}} />;
  const { rerender } = render(viewer());
  await waitFor(() => expect(screen.getByRole("dialog").querySelector(".file-code")).not.toBeNull());
  expect(gets.length).toBe(1);
  for (let i = 0; i < 5; i++) rerender(viewer());
  expect(gets.length).toBe(1);
  const onClose = vi.fn();
  rerender(viewer(onClose));
  fireEvent.keyDown(document, { key: "Escape" });
  expect(onClose).toHaveBeenCalledTimes(1);
  expect(gets.length).toBe(1);
});
