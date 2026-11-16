// How a message is styled as it's typed, and the edits behind the formatting shortcuts. The
// styling never changes the text: strip the tags and you have what was typed.
import { expect, test } from "vitest";
import { backspace, belowBlock, charAfter, charBefore, codeLine, forwardDelete, highlight, insideFence, link, newline, tidyPaste, wrap } from "./compose.ts";

const textOf = (html: string) => { const d = document.createElement("div"); d.innerHTML = html; return d.textContent; };
const lines = (html: string) => { const d = document.createElement("div"); d.innerHTML = html; return [...d.children].map((c) => c.className.replace(/^mi-line ?/, "")); };

test("whatever is typed, the box's text is the message, character for character", () => {
  for (const msg of ["", "plain", "a\nb\n", "\n\n", "`x` **b** *i* _i_ ~~s~~ [t](u) https://a.b @scout", "```ts\nconst a = `<b>`;\n```\nafter", "# h\n> q\n- one\n2. two", "a < b && c > d", "```\nnever closed\n"]) {
    expect(textOf(highlight(msg))).toBe(msg);
  }
});

test("inline code is set as code, with its ticks kept in the text but out of sight", () => {
  expect(highlight("run `npm test` now")).toBe('<span class="mi-line">run <span class="mi-hide">`</span><code class="mi-code">npm test</code><span class="mi-hide">`</span> now</span>');
  expect(highlight("a `tick").includes("mi-hide")).toBe(false); // one tick alone is just a tick, in plain sight
  expect(highlight("``a ` b``")).toContain('<code class="mi-code">a ` b</code>');
  expect(highlight("an odd ` tick")).not.toContain("<code");
  expect(highlight("`**not bold**`")).not.toContain("<b>"); // nothing is styled inside code
});

test("a fenced block is a code block from its opening line to its closing one, or to the end while it's open", () => {
  // mi-fence: a ``` line with code to show beside it, which is kept out of sight.
  expect(lines(highlight("see:\n```ts\nconst a = 1;\n```\ndone"))).toEqual(["", "mi-pre mi-fence mi-pre-top", "mi-pre", "mi-pre mi-fence mi-pre-end", ""]);
  expect(lines(highlight("```\nstill typing"))).toEqual(["mi-pre mi-fence mi-pre-top", "mi-pre mi-pre-end"]);
  expect(lines(highlight("```"))).toEqual(["mi-pre mi-pre-top mi-pre-end"]);           // nothing in it yet: the ``` is all there is to show
  expect(lines(highlight("```\n```"))).toEqual(["mi-pre mi-pre-top", "mi-pre mi-pre-end"]);
  expect(highlight("```ts\nconst a = 1;\n```")).toContain('<span class="mi-line mi-pre" data-lang="ts">const a = 1;'); // the language moves to the code
  expect(highlight("```\n**x** `y`\n```")).not.toMatch(/<b>|<code/); // code is left as it is
  expect(highlight("```js\nx")).toContain('<span class="mi-dim">```js</span>');
});

test("bold, italic, strike, links and mentions", () => {
  const h = highlight("**bold** *it* _it_ ~~gone~~ [docs](https://x.y/z) https://a.b/c @scout @links/app/src/a.ts");
  expect(h).toContain('<span class="mi-hide">**</span><b>bold</b><span class="mi-hide">**</span>');
  expect(h).toContain('<span class="mi-hide">*</span><i>it</i><span class="mi-hide">*</span>');
  expect(h).toContain('<span class="mi-hide">_</span><i>it</i><span class="mi-hide">_</span>');
  expect(h).toContain('<span class="mi-hide">~~</span><s>gone</s><span class="mi-hide">~~</span>');
  expect(h).toContain("<i>it</i>");
  expect(h.match(/<i>/g)?.length).toBe(2);
  expect(h).toContain("<s>gone</s>");
  expect(h).toContain('<span class="mi-link">docs</span><span class="mi-dim">](https://x.y/z)</span>');
  expect(h).toContain('<span class="mi-link">https://a.b/c</span>');
  expect(h).toContain('<span class="mi-at">@scout</span>');
  expect(h).toContain('<span class="mi-at">@links/app/src/a.ts</span>');
});

test("what only looks like formatting is left alone", () => {
  expect(highlight("2 * 3 * 4")).not.toContain("<i>");
  expect(highlight("snake_case_name and file_name.ts")).not.toContain("<i>");
  expect(highlight("a ** b")).not.toContain("<b>");
  expect(highlight("me@example.com")).not.toContain("mi-at");
});

test("headings, quotes and list markers", () => {
  expect(lines(highlight("# Title\n> said\n- one\n10. ten\nplain"))).toEqual(["mi-h", "mi-quote", "", "", ""]);
  expect(highlight("- one")).toContain('<span class="mi-mark">-</span> one');
  expect(highlight("  3) **three**")).toContain('  <span class="mi-mark">3)</span> <span class="mi-hide">**</span><b>three</b>');
  expect(highlight("# Title")).toContain('<span class="mi-dim"># </span>'); // these markers stay, dimmed
  expect(highlight("#hashtag")).not.toContain("mi-h");
});

test("an empty last line still has something to hold the cursor", () => {
  expect(highlight("")).toBe('<span class="mi-line"><br></span>');
  expect(highlight("a\n")).toBe('<span class="mi-line">a\n</span><span class="mi-line"><br></span>');
});

test("knowing whether the cursor is in an open code block", () => {
  const msg = "hi\n```js\ncode\n```\nbye";
  expect(insideFence(msg, 2)).toBe(false);
  expect(insideFence(msg, 8)).toBe(true);                     // at the end of the opening line
  expect(insideFence(msg, msg.indexOf("code") + 2)).toBe(true);
  expect(insideFence(msg, msg.indexOf("bye"))).toBe(false);
  expect(insideFence("```", 3)).toBe(true);
});

test("wrapping the selection in a marker, and taking it off again", () => {
  expect(wrap("make this bold", 5, 9, "**")).toEqual({ text: "make **this** bold", start: 7, end: 11 });
  expect(wrap("make **this** bold", 7, 11, "**")).toEqual({ text: "make this bold", start: 5, end: 9 });   // markers just outside
  expect(wrap("make **this** bold", 5, 13, "**")).toEqual({ text: "make this bold", start: 5, end: 9 });   // markers selected too
  expect(wrap("ab", 1, 1, "`")).toEqual({ text: "a``b", start: 2, end: 2 });                               // nothing selected: cursor between
  expect(wrap("a``b", 2, 2, "`")).toEqual({ text: "ab", start: 1, end: 1 });
});

test("making a link selects the address, ready to type over", () => {
  const e = link("see docs here", 4, 8);
  expect(e.text).toBe("see [docs](url) here");
  expect(e.text.slice(e.start, e.end)).toBe("url");
  expect(link("", 0, 0).text).toBe("[text](url)");
});

test("a new line carries a list or quote on, counts numbers up, and leaves the list from an empty item", () => {
  const at = (s: string) => newline(s, s.length, s.length);
  expect(at("plain").text).toBe("plain\n");
  expect(at("- one")).toEqual({ text: "- one\n- ", start: 8, end: 8 });
  expect(at("  * nested").text).toBe("  * nested\n  * ");
  expect(at("1. first").text).toBe("1. first\n2. ");
  expect(at("9) nine").text).toBe("9) nine\n10) ");
  expect(at("> quoted").text).toBe("> quoted\n> ");
  expect(at("- one\n- ")).toEqual({ text: "- one\n", start: 6, end: 6 });   // an empty item: the marker comes off
  expect(at("```\n- in code").text).toBe("```\n- in code\n");                // code is left as it is
  expect(newline("- one two", 5, 5).text).toBe("- one\n-  two");            // splitting an item
  expect(newline("abcdef", 2, 4)).toEqual({ text: "ab\nef", start: 3, end: 3 });
});

test("an emoji is one character to delete, though it's two in the text", () => {
  expect([charBefore("a😀", 3), charBefore("ab", 2), charAfter("😀a", 0), charAfter("ab", 0)]).toEqual([2, 1, 2, 1]);
});

test("three backticks around something on one line is inline code, not a block left open", () => {
  const one = "```npm test```";
  expect(lines(highlight(one))).toEqual([""]);
  expect(highlight(one)).toContain('<code class="mi-code">npm test</code>');
  expect(insideFence(one, one.length)).toBe(false);          // so Enter sends it
  expect(insideFence("run ```npm test``` now", 22)).toBe(false);
  expect(lines(highlight("```js\nlet a = `x`;\n```"))).toEqual(["mi-pre mi-fence mi-pre-top", "mi-pre", "mi-pre mi-fence mi-pre-end"]);
  expect(lines(highlight("```\n``` not a closing line\n```"))).toEqual(["mi-pre mi-fence mi-pre-top", "mi-pre", "mi-pre mi-fence mi-pre-end"]);
  expect(lines(highlight("~~~\ncode\n~~~\nafter"))).toEqual(["mi-pre mi-fence mi-pre-top", "mi-pre", "mi-pre mi-fence mi-pre-end", ""]);
  expect(insideFence("```js", 5)).toBe(true);                 // a language after the backticks still opens one
  expect(insideFence("```\ncode\n```", 12)).toBe(false);     // at the end of the closing line: outside again
});

test("Enter on a block's opening line closes the block too, and leaves the cursor inside it", () => {
  // …and an empty line below, when the block would end the message: somewhere to go on writing.
  expect(codeLine("```", 3, 3)).toEqual({ text: "```\n\n```\n", start: 4, end: 4 });
  expect(codeLine("see:\n```ts", 10, 10)).toEqual({ text: "see:\n```ts\n\n```\n", start: 11, end: 11 });
  expect(codeLine("~~~~", 4, 4).text).toBe("~~~~\n\n~~~~\n");
  expect(codeLine("```\nafter", 3, 3).text).toBe("```\n\n```\nafter");
  // A block that already has its closing line, and lines inside a block, just get a new line.
  expect(codeLine("```\n\n```", 3, 3)).toEqual({ text: "```\n\n\n```", start: 4, end: 4 });
  expect(codeLine("```\nlet a;", 10, 10)).toEqual({ text: "```\nlet a;\n", start: 11, end: 11 });
  expect(codeLine("```js", 3, 3).text).toBe("```\njs");       // the cursor wasn't at the end of the line
});

test("Backspace is one character, except where it would eat into a block's hidden ``` line", () => {
  expect(backspace("abc", 2)).toEqual({ text: "ac", start: 1, end: 1 });
  expect(backspace("abc", 0)).toBeNull();
  expect(backspace("a😀", 3)?.text).toBe("a");
  expect(backspace("`test`", 6)).toEqual({ text: "`test", start: 5, end: 5 });          // a marker is a character too: the code comes undone
  // At the start of a block's first line of code: the block is unwrapped, and the code stays.
  expect(backspace("see\n```js\nlet a;\nlet b;\n```\nafter", 10)).toEqual({ text: "see\nlet a;\nlet b;\nafter", start: 4, end: 4 });
  expect(backspace("```\n\n```\n", 4)).toEqual({ text: "\n", start: 0, end: 0 });            // an empty block simply goes
  expect(backspace("```\nopen still", 4)).toEqual({ text: "open still", start: 0, end: 0 });  // no closing line to take
  expect(backspace("```\nlet a;\nlet b;\n```", 11)?.text).toBe("```\nlet a;let b;\n```"); // inside the code: an ordinary join
  // Just below a block: an empty line goes; text there is left alone rather than joined to the ```.
  expect(backspace("```\nx\n```\n", 10)).toEqual({ text: "```\nx\n```", start: 9, end: 9 });
  expect(backspace("```\nx\n```\nafter", 10)).toBeNull();
});

test("Delete never pulls a ``` line up into the line above it", () => {
  expect(forwardDelete("abc", 1)).toEqual({ text: "ac", start: 1, end: 1 });
  expect(forwardDelete("abc", 3)).toBeNull();
  expect(forwardDelete("```\nx\n```", 5)).toBeNull();          // end of the last line of code
  expect(forwardDelete("before\n```\nx\n```", 6)).toBeNull();  // end of the line above a block
  expect(forwardDelete("```\nx\ny\n```", 5)?.text).toBe("```\nxy\n```");
});

test("the down arrow on a block's last line makes a line below, when the block ends the message", () => {
  expect(belowBlock("```\nx\n```", 5)).toEqual({ text: "```\nx\n```\n", start: 10, end: 10 });
  expect(belowBlock("```\nx\ny\n```", 5)).toBeNull();     // not the last line of code
  expect(belowBlock("```\nx\n```\nafter", 5)).toBeNull(); // there's a line to go to already
  expect(belowBlock("plain", 3)).toBeNull();
});

test("a block pasted from a chat, with its ``` run on to the text, is put on lines of its own", () => {
  // Slack's way: the first line would be read as the language (and lost), and the block never closed.
  expect(tidyPaste("```automatic project creation, I think\n[11:49 AM] What if we asked them```"))
    .toBe("```\nautomatic project creation, I think\n[11:49 AM] What if we asked them\n```");
  expect(tidyPaste("see:\n```one line only```\nthanks")).toBe("see:\n```one line only```\nthanks"); // inline code: left alone
  expect(tidyPaste("```ts\nconst a = 1;\n```")).toBe("```ts\nconst a = 1;\n```");       // a real language stays
  expect(tidyPaste("```ts\nconst a = 1;```")).toBe("```ts\nconst a = 1;\n```");           // only the end run on
  expect(tidyPaste("```first words\nmore\n```")).toBe("```\nfirst words\nmore\n```");
  expect(tidyPaste("no blocks here")).toBe("no blocks here");
  // And in the box, a sentence after ``` is never drawn as the block's language label.
  expect(highlight("```automatic project creation\ncode")).not.toContain("data-lang");
  expect(highlight("```automatic project creation\ncode")).not.toContain("mi-fence"); // and that line isn't hidden
});
