// A unified diff laid out old beside new, and the small pieces of getting about by keyboard:
// which typed text is a command for the page, and which code in an answer is a file to open.
import { expect, test } from "vitest";
import { parseCommand } from "./bus.ts";
import { sideBySide } from "./diff.ts";
import { pathIn } from "./markdown.tsx";

const show = (diff: string) => sideBySide(diff).map((r) => r.kind === "hunk" ? `~ ${r.label}` : `${r.left ? `${r.left.n}:${r.left.text}` : "·"} | ${r.right ? `${r.right.n}:${r.right.text}` : "·"}`);

test("removed lines sit beside the lines that replaced them", () => {
  const diff = "diff --git a/a.ts b/a.ts\nindex 1..2 100644\n--- a/a.ts\n+++ b/a.ts\n@@ -1,4 +1,5 @@\n one\n-two\n-three\n+TWO\n+THREE\n+and a half\n four\n";
  expect(show(diff)).toEqual(["1:one | 1:one", "2:two | 2:TWO", "3:three | 3:THREE", "· | 4:and a half", "4:four | 5:four"]);
  expect(sideBySide(diff).map((r) => r.kind)).toEqual(["same", "changed", "changed", "changed", "same"]);
});

test("lines only taken away, hunks further down the file, and a file that's all new", () => {
  expect(show("@@ -3,3 +3,2 @@ function a() {\n keep\n-gone\n end\n@@ -20,2 +19,2 @@ function b() {\n-x\n+y\n z\n"))
    .toEqual(["3:keep | 3:keep", "4:gone | ·", "5:end | 4:end", "~ function b() {", "20:x | 19:y", "21:z | 20:z"]);
  expect(show("@@ -0,0 +1,2 @@\n+first\n+second")).toEqual(["· | 1:first", "· | 2:second"]);
  expect(show("@@ -1 +1 @@\n-a\n\\ No newline at end of file\n+b\n")).toEqual(["1:a | 1:b"]);
  expect(sideBySide("")).toEqual([]);
});

test("a message that starts with one of the page's commands is for the page", () => {
  expect(parseCommand("/new")).toEqual({ name: "new", arg: "" });
  expect(parseCommand("  /good  clear and short ")).toEqual({ name: "good", arg: "clear and short" });
  expect(parseCommand("/find Button")).toEqual({ name: "find", arg: "Button" });
  expect(parseCommand("/usr/local/bin is on my path")).toBeNull(); // not one of ours: it goes to the crew
  expect(parseCommand("/deploy now")).toBeNull();
  expect(parseCommand("see /new")).toBeNull();
});

test("code in an answer that's a file path can be opened, with its line if it names one", () => {
  expect(pathIn("apps/root/custom.d.ts")).toEqual({ path: "apps/root/custom.d.ts" });
  expect(pathIn("links/mi-web-app/src/a.ts:42")).toEqual({ path: "links/mi-web-app/src/a.ts", line: 42 });
  expect(pathIn("./src/app/[id]/page.tsx:7:3")).toEqual({ path: "./src/app/[id]/page.tsx", line: 7 });
  expect(pathIn("/Users/me/site/README.md")).toEqual({ path: "/Users/me/site/README.md" });
  for (const not of ["npm test", "useState", "package.json", "a/b", "https://x.y/z.html", "1/2.5", "git diff --stat", "src/"]) expect(pathIn(not), not).toBeNull();
});
