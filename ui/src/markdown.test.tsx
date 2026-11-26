// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import { Markdown } from "./markdown.tsx";

const md = (text: string) => render(<Markdown text={text} />).container.querySelector(".md")!;

describe("inline formatting", () => {
  it("lets bold wrap a code span", () => {
    const el = md("replaced it with **`d8802c3e6d`** and pushed");
    expect(el.querySelector("strong code")?.textContent).toBe("d8802c3e6d");
    expect(el.textContent).not.toContain("*");
  });

  it("formats nothing inside a code span", () => {
    const el = md("run `a **b** c` first");
    expect(el.querySelector("code")?.textContent).toBe("a **b** c");
    expect(el.querySelector("strong")).toBeNull();
  });

  it("keeps a code span in a link's label, and the link's address as written", () => {
    const el = md("see [`memory.ts`](https://example.com/a_b) and https://example.com/x.");
    const [first, second] = [...el.querySelectorAll("a")];
    expect(first.getAttribute("href")).toBe("https://example.com/a_b");
    expect(first.querySelector("code")?.textContent).toBe("memory.ts");
    expect(second.getAttribute("href")).toBe("https://example.com/x");
  });
});

describe("lists", () => {
  it("nests a list set in under an item", () => {
    const el = md("- one\n  - inner a\n  - inner b\n- two");
    const top = el.querySelector(":scope > ul")!;
    expect(top.querySelectorAll(":scope > li")).toHaveLength(2);
    expect(top.querySelectorAll(":scope > li:first-child > ul > li")).toHaveLength(2);
  });

  it("keeps counting when bullets under a numbered item are set in", () => {
    const el = md("1. first\n   - a\n   - b\n2. second\n3. third");
    const lists = el.querySelectorAll(":scope > ol");
    expect(lists).toHaveLength(1);
    expect(lists[0].querySelectorAll(":scope > li")).toHaveLength(3);
  });

  it("starts a numbered list at the number it was written with", () => {
    const el = md("1. first\n- a\n- b\n2. second");
    const lists = el.querySelectorAll(":scope > ol");
    expect(lists).toHaveLength(2);
    expect(lists[0].hasAttribute("start")).toBe(false);
    expect(lists[1].getAttribute("start")).toBe("2");
  });

  it("is one list across blank lines between its items", () => {
    const el = md("1. first\n\n2. second\n\n3. third\n\nAfter.");
    expect(el.querySelectorAll("ol")).toHaveLength(1);
    expect(el.querySelectorAll("ol > li")).toHaveLength(3);
    expect(el.querySelector("p")?.textContent).toBe("After.");
  });

  it("shows a code block set in under an item as code, even when its lines aren't set in", () => {
    const el = md("- `git verify-commit HEAD` (exit 0):\n  ```\ngpg: Good signature\n  ```\n- next");
    expect(el.querySelector("li > pre > code")?.textContent).toBe("gpg: Good signature");
    expect(el.textContent).not.toContain("```");
    expect(el.querySelectorAll(":scope > ul > li")).toHaveLength(2);
  });

  it("joins a wrapped line to its item, and keeps a checklist's boxes", () => {
    const el = md("- [x] done\n  and dusted\n- [ ] not yet");
    const items = el.querySelectorAll("li.md-task");
    expect(items).toHaveLength(2);
    expect(items[0].textContent).toContain("done and dusted");
    expect((items[0].querySelector("input") as HTMLInputElement).checked).toBe(true);
  });

  it("ends a list at a paragraph back at the margin", () => {
    const el = md("- one\n- two\nThen a sentence.");
    expect(el.querySelectorAll("ul > li")).toHaveLength(2);
    expect(el.querySelector(":scope > p")?.textContent).toBe("Then a sentence.");
  });
});

describe("code blocks", () => {
  it("takes a fence that's set in, without its indentation", () => {
    const el = md("Before\n\n  ```ts\n  const a = 1;\n  ```\n\nAfter");
    expect(el.querySelector("pre > code")?.textContent).toBe("const a = 1;");
  });
});

describe("tables", () => {
  const rows = (el: Element) => [...el.querySelectorAll("tbody tr")].map((tr) => [...tr.querySelectorAll("td")].map((td) => td.textContent).join(" / "));

  it("draws a table in its own box, a cell for each column", () => {
    const el = md("| # | Line | RIGHT |\n|---|:---|--:|\n| 1 | First | yes |\n| 2 | Second | no |");
    expect(el.querySelector(".md-table > table")).toBeTruthy();
    expect([...el.querySelectorAll("th")].map((th) => th.textContent)).toEqual(["#", "Line", "RIGHT"]);
    expect(rows(el)).toEqual(["1 / First / yes", "2 / Second / no"]);
    expect(el.querySelectorAll(".md-row-cut")).toHaveLength(0);
  });

  it("keeps a row cut off with … in the table, marked as cut, instead of showing its pipes", () => {
    const el = md("| # | Step | Who |\n|---|---|---|\n| 3 | Write the notes | Scribe |\n| 4 | Trackin…");
    expect(el.textContent).not.toContain("|");
    expect(rows(el)).toEqual(["3 / Write the notes / Scribe", "4 / Trackin… / "]);
    expect(el.querySelectorAll("tbody tr.md-row-cut")).toHaveLength(1);
    expect(el.querySelector("tbody tr:last-child")!.classList.contains("md-row-cut")).toBe(true);
  });

  it("draws a table that is still coming in: a half-written row, and a head whose dashes are still arriving", () => {
    const partRow = md("Here's the plan:\n\n| # | Step |\n|---|---|\n| 1 | Scout reads | \n| 2 | Artif");
    expect(partRow.querySelector("p")!.textContent).toBe("Here's the plan:");
    expect(rows(partRow)).toEqual(["1 / Scout reads", "2 / Artif"]);
    expect(partRow.textContent).not.toContain("|");
    const partHead = md("| # | Step |\n|---|--");
    expect([...partHead.querySelectorAll("th")].map((th) => th.textContent)).toEqual(["#", "Step"]);
    expect(partHead.textContent).not.toContain("|");
  });

  it("a half row of dashes only counts at the very end, and a line of pipes on its own is just text", () => {
    const el = md("| a | b |\n|---|--\nmore");
    expect(el.querySelector("table")).toBeNull();
    expect(md("| not | a table |").querySelector("table")).toBeNull();
  });

  it("ends a table at the first line that isn't one of its rows", () => {
    const el = md("| a | b |\n|---|---|\n| 1 | 2 |\nAfter the table.");
    expect(rows(el)).toEqual(["1 / 2"]);
    expect(el.querySelector(":scope > p")?.textContent).toBe("After the table.");
  });
});
