// Colouring code for the file viewer: the language is told from the file's name, the colouring
// keeps every character of the file, and nothing in a file can come out as markup of its own.
import { expect, test } from "vitest";
import { colourCode, languageOf } from "./code.ts";

const textOf = (html: string) => { const d = document.createElement("div"); d.innerHTML = html; return d.textContent; };
const kinds = (html: string) => { const d = document.createElement("div"); d.innerHTML = html; return [...d.querySelectorAll("span")].map((s) => `${s.className.replace(/hljs-/g, "")}:${s.textContent}`); };

test("a file's language is told from its name", () => {
  const name = (f: string) => languageOf(f)?.name ?? null;
  expect([name("apps/root/custom.d.ts"), name("App.tsx"), name("index.mjs"), name("package.json"), name(".oxfmtrc"), name("README.md")])
    .toEqual(["TypeScript", "TypeScript", "JavaScript", "JSON", "JSON", "Markdown"]);
  expect([name("ci.yml"), name("a.module.scss"), name("page.html"), name("logo.svg"), name("run.sh"), name(".zshrc"), name("Dockerfile"), name("Makefile")])
    .toEqual(["YAML", "SCSS", "HTML", "HTML", "Shell", "Shell", "Dockerfile", "Makefile"]);
  expect([name("main.py"), name("main.go"), name("lib.rs"), name("query.sql"), name("schema.graphql"), name("fix.patch"), name("pyproject.toml"), name(".editorconfig")])
    .toEqual(["Python", "Go", "Rust", "SQL", "GraphQL", "Diff", "Config", "Config"]);
  expect([name("notes.txt"), name("LICENSE"), name("archive.bin")]).toEqual([null, null, null]);
});

test("code is coloured by what each piece is, and every character is kept", () => {
  const ts = 'declare module "*.png" {\n  const content: string; // a path\n  export default content;\n}\n';
  const html = colourCode(ts, "custom.d.ts")!;
  expect(textOf(html)).toBe(ts);
  const found = kinds(html);
  expect(found).toContain("keyword:declare");
  expect(found).toContain('string:"*.png"');
  expect(found).toContain("comment:// a path");
  expect(found).toContain("built_in:string");

  const json = '{ "name": "satchel", "private": true, "port": 4747 }';
  expect(textOf(colourCode(json, "package.json")!)).toBe(json);
  expect(kinds(colourCode(json, "package.json")!)).toEqual(expect.arrayContaining(['attr:"name"', 'string:"satchel"', "number:4747"]));
  expect(kinds(colourCode(".card { color: red; }", "a.css")!)).toEqual(expect.arrayContaining(["selector-class:.card", "attribute:color"]));
});

test("nothing in a file comes out as markup of its own", () => {
  const nasty = 'const a = "<img src=x onerror=alert(1)>"; // <script>alert(2)</script>\n';
  const html = colourCode(nasty, "a.ts")!;
  expect(textOf(html)).toBe(nasty);
  const d = document.createElement("div");
  d.innerHTML = html;
  expect(d.querySelector("img, script")).toBeNull();
  expect([...d.querySelectorAll("*")].every((el) => el.tagName === "SPAN")).toBe(true);
  const page = colourCode('<a href="x" onclick="go()">hi</a>', "index.html")!;
  d.innerHTML = page;
  expect(d.querySelector("a")).toBeNull();
  expect(d.textContent).toBe('<a href="x" onclick="go()">hi</a>');
});

test("a language that isn't known, or a file too long to be worth the wait, is shown plain", () => {
  expect(colourCode("just words", "notes.txt")).toBeNull();
  expect(colourCode("x".repeat(200_001), "big.ts")).toBeNull();
  expect(colourCode("", "empty.ts")).toBe("");
});
