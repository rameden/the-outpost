// The Files flyout: it lists the attached folder, opens folders a level at a time, marks what
// git says changed, opens a file in a viewer, puts references in your message, and leaves
// secrets shut.
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { FilesPanel, FilesRail } from "./Files.tsx";

const gets: string[] = [];
let worktreeGone = false;
beforeEach(() => {
  gets.length = 0; worktreeGone = false;
  localStorage.clear();
  vi.stubGlobal("fetch", vi.fn(async (url: string) => {
    gets.push(url);
    const q = new URL(url, "http://camp").searchParams;
    const path = q.get("path");
    if (q.get("root") && worktreeGone) return new Response(JSON.stringify({ error: "That isn't a worktree of links/demo." }), { status: 400 });
    if (url.startsWith("/api/tree/file")) return new Response(JSON.stringify({ path, abs: `/work/demo/${path}`, size: 14, text: "# Demo\nHello.\n" }));
    if (path === "") return new Response(JSON.stringify({
      root: "/work/demo", changed: { "src/app.ts": "M", "notes/": "U" },
      entries: [{ name: "notes", dir: true }, { name: "src", dir: true }, { name: ".env", dir: false, size: 20, secret: true }, { name: "README.md", dir: false, size: 14 }],
    }));
    if (path === "src") return new Response(JSON.stringify({ root: "/work/demo", entries: [{ name: "app.ts", dir: false, size: 120 }, { name: "page [id].tsx", dir: false, size: 9 }] }));
    return new Response(JSON.stringify({ root: "/work/demo", entries: [] }));
  }));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

const show = (roots = [{ link: "demo" } as { link: string; path?: string; branch?: string }]) => {
  const onHide = vi.fn(), onMention = vi.fn();
  render(<FilesPanel roots={roots} onHide={onHide} onMention={onMention} />);
  return { onHide, onMention };
};
const row = (name: string) => screen.getByText(name).closest("button")!;

test("it lists the attached folder, and opens a folder when you click it", async () => {
  show();
  await screen.findByText("README.md");
  expect(row("demo").getAttribute("aria-expanded")).toBe("true");
  expect(screen.queryByText("app.ts")).toBeNull();
  fireEvent.click(row("src"));
  await screen.findByText("app.ts");
  expect(gets).toEqual(["/api/tree?link=demo&path=", "/api/tree?link=demo&path=src"]);
  expect(row("src").getAttribute("aria-expanded")).toBe("true");
  fireEvent.click(row("src"));
  expect(screen.queryByText("app.ts")).toBeNull();
});

test("files git reports as changed carry a letter, and the folders around them a dot", async () => {
  show();
  fireEvent.click(await screen.findByText("src"));
  await screen.findByText("app.ts");
  expect(row("app.ts").textContent).toContain("M");
  expect(row("src").textContent).toContain("•");
  expect(row("notes").textContent).toContain("U");
  expect(row("README.md").querySelector(".ft-mark")).toBeNull();
});

test("the @ beside a row puts a reference to it in your message", async () => {
  const { onMention } = show();
  fireEvent.click(await screen.findByText("src"));
  await screen.findByText("app.ts");
  fireEvent.click(screen.getByRole("button", { name: "Mention app.ts in your message" }));
  fireEvent.click(screen.getByRole("button", { name: "Mention src in your message" }));
  fireEvent.click(screen.getByRole("button", { name: "Mention demo in your message" }));
  expect(onMention.mock.calls.map((c) => c[0])).toEqual(["links/demo/src/app.ts", "links/demo/src/", "links/demo/"]);
});

test("a file opens in a viewer with its text, and can be mentioned from there", async () => {
  const { onMention } = show();
  fireEvent.click(await screen.findByText("README.md"));
  const dialog = await screen.findByRole("dialog", { name: "links/demo/README.md" });
  await waitFor(() => expect(dialog.querySelector(".file-code")?.textContent).toBe("# Demo\nHello."));
  expect(dialog.textContent).toContain("2 lines");
  expect(dialog.textContent).toContain("Markdown ·");                     // its language, told from its name
  expect(dialog.querySelector(".file-code .hljs-section")?.textContent).toBe("# Demo"); // and coloured as that
  expect(dialog.querySelector(".file-nums")?.textContent).toBe("1\n2");
  fireEvent.click(screen.getByRole("button", { name: "Mention in message" }));
  expect(onMention).toHaveBeenCalledWith("links/demo/README.md");
  expect(screen.queryByRole("dialog")).toBeNull();
  fireEvent.click(screen.getByText("README.md"));
  await screen.findByRole("dialog");
  fireEvent.keyDown(document, { key: "Escape" });
  expect(screen.queryByRole("dialog")).toBeNull();
});

test("a secret is listed but never opened", async () => {
  show();
  fireEvent.click(await screen.findByText(".env"));
  expect(gets.some((u) => u.startsWith("/api/tree/file"))).toBe(false);
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(screen.queryByRole("button", { name: "Mention .env in your message" })).toBeNull();
});

test("a conversation's worktree is shown with its branch; once it's gone, the folder itself", async () => {
  show([{ link: "demo", path: "/work/demo-camp/fix", branch: "camp/fix" }]);
  await screen.findByText("README.md");
  expect(gets[0]).toBe("/api/tree?link=demo&root=%2Fwork%2Fdemo-camp%2Ffix&path=");
  expect(row("demo").textContent).toContain("camp/fix");
  cleanup();

  gets.length = 0; worktreeGone = true;
  show([{ link: "demo", path: "/work/demo-camp/fix", branch: "camp/fix" }]);
  await screen.findByText("README.md");
  expect(gets).toEqual(["/api/tree?link=demo&root=%2Fwork%2Fdemo-camp%2Ffix&path=", "/api/tree?link=demo&path="]);
  expect(row("demo").textContent).not.toContain("camp/fix");
});

test("arrow keys walk the tree, refresh reads it again, and it hides", async () => {
  const { onHide } = show();
  await screen.findByText("README.md");
  row("demo").focus();
  fireEvent.keyDown(row("demo"), { key: "ArrowDown" });
  expect(document.activeElement).toBe(row("notes"));
  fireEvent.keyDown(row("notes"), { key: "ArrowDown" });
  fireEvent.keyDown(row("src"), { key: "ArrowRight" });
  await screen.findByText("app.ts");
  fireEvent.keyDown(row("src"), { key: "ArrowRight" });
  expect(document.activeElement).toBe(row("app.ts"));
  fireEvent.keyDown(row("app.ts"), { key: "ArrowLeft" });
  expect(document.activeElement).toBe(row("src"));

  const before = gets.length;
  fireEvent.click(screen.getByRole("button", { name: "Refresh the files" }));
  await waitFor(() => expect(gets.slice(before)).toEqual(["/api/tree?link=demo&path=", "/api/tree?link=demo&path=src"]));
  fireEvent.click(screen.getByRole("button", { name: "Hide the files" }));
  expect(onHide).toHaveBeenCalled();
});

test("the tab on the right edge brings it back", () => {
  const onShow = vi.fn();
  render(<FilesRail onShow={onShow} />);
  fireEvent.click(screen.getByRole("button", { name: "Show files" }));
  expect(onShow).toHaveBeenCalled();
});
