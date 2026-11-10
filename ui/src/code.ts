// Colouring code by what each piece of it is (keywords, strings, comments…), for the file viewer.
//
// The reading of each language is highlight.js's; only the languages named here are built into
// the page. What comes back is HTML with every character of the file still in it, wrapped in
// spans the stylesheet colours (.hljs-… under "Code colours"): nothing in the file can come
// out as markup of its own. A file in a language that isn't here, or one too long to be worth
// the wait, is shown plain.

import hljs from "highlight.js/lib/core";
import bash from "highlight.js/lib/languages/bash";
import c from "highlight.js/lib/languages/c";
import cpp from "highlight.js/lib/languages/cpp";
import csharp from "highlight.js/lib/languages/csharp";
import css from "highlight.js/lib/languages/css";
import diff from "highlight.js/lib/languages/diff";
import dockerfile from "highlight.js/lib/languages/dockerfile";
import go from "highlight.js/lib/languages/go";
import graphql from "highlight.js/lib/languages/graphql";
import ini from "highlight.js/lib/languages/ini";
import java from "highlight.js/lib/languages/java";
import javascript from "highlight.js/lib/languages/javascript";
import json from "highlight.js/lib/languages/json";
import kotlin from "highlight.js/lib/languages/kotlin";
import less from "highlight.js/lib/languages/less";
import lua from "highlight.js/lib/languages/lua";
import makefile from "highlight.js/lib/languages/makefile";
import markdown from "highlight.js/lib/languages/markdown";
import php from "highlight.js/lib/languages/php";
import python from "highlight.js/lib/languages/python";
import ruby from "highlight.js/lib/languages/ruby";
import rust from "highlight.js/lib/languages/rust";
import scss from "highlight.js/lib/languages/scss";
import sql from "highlight.js/lib/languages/sql";
import swift from "highlight.js/lib/languages/swift";
import typescript from "highlight.js/lib/languages/typescript";
import xml from "highlight.js/lib/languages/xml";
import yaml from "highlight.js/lib/languages/yaml";

const LANGUAGES = { bash, c, cpp, csharp, css, diff, dockerfile, go, graphql, ini, java, javascript, json, kotlin, less, lua, makefile, markdown, php, python, ruby, rust, scss, sql, swift, typescript, xml, yaml };
for (const [id, grammar] of Object.entries(LANGUAGES)) hljs.registerLanguage(id, grammar);

export type Language = { id: keyof typeof LANGUAGES; name: string };
const lang = (id: Language["id"], name: string): Language => ({ id, name });

// A file's language, from its name. The first that fits wins.
const BY_NAME: [RegExp, Language][] = [
  [/^dockerfile(\..+)?$|\.dockerfile$/i, lang("dockerfile", "Dockerfile")],
  [/^(gnu)?makefile$|\.mk$/i, lang("makefile", "Makefile")],
  [/^\.(bashrc|zshrc|profile|bash_profile|zprofile|envrc)$|\.(sh|bash|zsh|fish|command)$/i, lang("bash", "Shell")],
  [/\.(ts|tsx|mts|cts)$/i, lang("typescript", "TypeScript")],
  [/\.(js|jsx|mjs|cjs)$/i, lang("javascript", "JavaScript")],
  [/\.(json|jsonc|json5|webmanifest|map|tsbuildinfo)$|^\.(babelrc|eslintrc|prettierrc|oxfmtrc|oxlintrc|swcrc)$/i, lang("json", "JSON")],
  [/\.(md|mdx|markdown)$/i, lang("markdown", "Markdown")],
  [/\.(ya?ml)$|^\.clang-format$/i, lang("yaml", "YAML")],
  [/\.(scss|sass)$/i, lang("scss", "SCSS")],
  [/\.less$/i, lang("less", "Less")],
  [/\.(css|pcss)$/i, lang("css", "CSS")],
  [/\.(html?|xml|svg|vue|svelte|astro|plist|xhtml|xsl)$/i, lang("xml", "HTML")],
  [/\.(py|pyi|pyw)$/i, lang("python", "Python")],
  [/\.go$/i, lang("go", "Go")],
  [/\.rs$/i, lang("rust", "Rust")],
  [/\.(java)$/i, lang("java", "Java")],
  [/\.(kt|kts)$/i, lang("kotlin", "Kotlin")],
  [/\.swift$/i, lang("swift", "Swift")],
  [/\.(c|h)$/i, lang("c", "C")],
  [/\.(cc|cpp|cxx|hpp|hh|hxx|ino)$/i, lang("cpp", "C++")],
  [/\.cs$/i, lang("csharp", "C#")],
  [/\.php$/i, lang("php", "PHP")],
  [/\.(rb|rake|gemspec)$|^(gemfile|rakefile)$/i, lang("ruby", "Ruby")],
  [/\.lua$/i, lang("lua", "Lua")],
  [/\.sql$/i, lang("sql", "SQL")],
  [/\.(graphql|gql)$/i, lang("graphql", "GraphQL")],
  [/\.(diff|patch)$/i, lang("diff", "Diff")],
  [/\.(toml|ini|cfg|conf|properties|editorconfig)$|^\.(editorconfig|gitconfig|npmrc|nvmrc|gitattributes)$/i, lang("ini", "Config")],
];
export function languageOf(fileName: string): Language | null {
  const base = fileName.split("/").pop() ?? fileName;
  return BY_NAME.find(([re]) => re.test(base))?.[1] ?? null;
}

const MAX_CHARS = 200_000; // beyond this, colouring takes long enough to notice, and the file is shown plain

// The file's text as HTML, coloured; or nothing, when it's to be shown plain.
export function colourCode(text: string, fileName: string): string | null {
  const language = languageOf(fileName);
  if (!language || text.length > MAX_CHARS) return null;
  try { return hljs.highlight(text, { language: language.id, ignoreIllegals: true }).value; }
  catch { return null; }
}
