// The message box as you'd use it: typing, deleting and pasting become edits of the text, the
// box is drawn styled from that text with the cursor put back, and the shortcuts format it.
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { createRef, useState } from "react";
import { afterEach, expect, test, vi } from "vitest";
import { MessageInput, type MessageInputHandle } from "./MessageInput.tsx";
import { kindOf } from "./Files.tsx";

afterEach(cleanup);

function setup(start = "") {
  const ref = createRef<MessageInputHandle>();
  const onKeyDown = vi.fn();
  function Host() {
    const [text, setText] = useState(start);
    return <MessageInput ref={ref} value={text} onChange={setText} onKeyDown={onKeyDown} placeholder="Say something" label="Message" />;
  }
  const { container } = render(<Host />);
  const box = container.querySelector<HTMLElement>(".mi")!;
  const h = () => ref.current!;
  act(() => h().focus()); // the cursor starts at the end of what's there
  // What the browser reports it's about to do; the box does it to the text instead.
  const input = (inputType: string, data: string | null = null) => act(() => { box.dispatchEvent(new InputEvent("beforeinput", { inputType, data, bubbles: true, cancelable: true })); });
  const type = (s: string) => { for (const ch of s) input("insertText", ch); };
  const at = (a: number, b = a) => act(() => h().setSelectionRange(a, b));
  const key = (k: string, more: object = {}) => fireEvent.keyDown(box, { key: k, ctrlKey: true, ...more });
  return { box, h, input, type, at, key, onKeyDown };
}

test("typing goes into the text, and the box is drawn styled with the cursor after what was typed", () => {
  const { box, h, type } = setup();
  expect(box.hasAttribute("data-empty")).toBe(true);
  type("use `npm`");
  expect(h().value).toBe("use `npm`");
  expect(box.textContent).toBe("use `npm`");
  expect(box.querySelector("code")?.textContent).toBe("npm");
  expect([h().selectionStart, h().selectionEnd]).toEqual([9, 9]);
  expect(box.hasAttribute("data-empty")).toBe(false);
  expect(box.getAttribute("role")).toBe("textbox");
});

test("the cursor can be put anywhere, and typing or deleting happens there", () => {
  const { h, type, at, input } = setup("hello world");
  at(5);
  type(",");
  expect(h().value).toBe("hello, world");
  expect(h().selectionStart).toBe(6);
  input("deleteContentBackward");
  expect(h().value).toBe("hello world");
  input("deleteContentForward");
  expect(h().value).toBe("helloworld");
  at(0, 5);
  type("H");
  expect(h().value).toBe("Hworld"); // typing over a selection replaces it
  at(0);
  input("deleteContentBackward");
  expect(h().value).toBe("Hworld"); // nothing before the start to delete
});

test("lines: the cursor lands at the start of the next line, on an empty last line, and back", () => {
  const { box, h, input, type, at } = setup("one");
  input("insertLineBreak");
  expect(h().value).toBe("one\n");
  expect(h().selectionStart).toBe(4);
  expect(box.children.length).toBe(2);
  type("two");
  expect(h().value).toBe("one\ntwo");
  at(4);
  input("deleteContentBackward"); // at the start of a line: joins it to the one above
  expect(h().value).toBe("onetwo");
  expect(h().selectionStart).toBe(3);
});

test("a new line carries a list on, and an empty item ends it", () => {
  const { h, input, type } = setup("- milk");
  input("insertLineBreak");
  type("eggs");
  expect(h().value).toBe("- milk\n- eggs");
  input("insertParagraph");
  input("insertLineBreak");
  expect(h().value).toBe("- milk\n- eggs\n");
});

test("pasted text goes in as plain text, with its line ends tidied", () => {
  const { h, input, at } = setup("ab");
  at(1);
  input("insertFromPaste", "x\r\ny");
  expect(h().value).toBe("ax\nyb");
  expect(h().selectionStart).toBe(4);
});

test("shortcuts wrap the selection: bold, italic, code, strike, link; again takes it off", () => {
  const { h, at, key } = setup("make this stand out");
  at(5, 9);
  key("b");
  expect(h().value).toBe("make **this** stand out");
  expect([h().selectionStart, h().selectionEnd]).toEqual([7, 11]);
  key("b");
  expect(h().value).toBe("make this stand out");
  key("i");
  expect(h().value).toBe("make *this* stand out");
  key("i");
  key("e");
  expect(h().value).toBe("make `this` stand out");
  key("e");
  key("x", { shiftKey: true });
  expect(h().value).toBe("make ~~this~~ stand out");
  key("x", { shiftKey: true });
  key("k");
  expect(h().value).toBe("make [this](url) stand out");
  expect(h().value.slice(h().selectionStart, h().selectionEnd)).toBe("url");
});

test("undo and redo step through what you did; a word of typing is one step", () => {
  const { h, type, at, key } = setup("start");
  type("ed");
  type(" again"); // the space starts a new step
  at(0, 7);
  key("b");
  expect(h().value).toBe("**started** again");
  key("z");
  expect(h().value).toBe("started again");
  key("z");
  expect(h().value).toBe("started ");
  key("z");
  expect(h().value).toBe("started");
  key("z");
  expect(h().value).toBe("start");
  key("z");
  expect(h().value).toBe("start"); // nothing further back
  key("z", { shiftKey: true });
  key("z", { shiftKey: true });
  key("z", { shiftKey: true });
  expect(h().value).toBe("started again");
  key("z", { shiftKey: true });
  expect(h().value).toBe("**started** again");
});

test("other keys go to whoever owns the box; Tab indents only inside an open code block", () => {
  const { h, key, onKeyDown, box, at } = setup("```\ncode");
  fireEvent.keyDown(box, { key: "Enter" });
  expect(onKeyDown).toHaveBeenCalledTimes(1);
  expect(h().inCode()).toBe(true);
  fireEvent.keyDown(box, { key: "Tab" });
  expect(h().value).toBe("```\ncode  ");
  act(() => h().insert("\n```\n"));
  expect(h().inCode()).toBe(false);
  const before = h().value;
  fireEvent.keyDown(box, { key: "Tab" });
  expect(h().value).toBe(before); // outside code, Tab moves on as usual
  key("b");
  expect(onKeyDown).toHaveBeenCalledTimes(3); // the shortcut was the box's own
  at(0);
  expect(h().selectionStart).toBe(0);
});

test("text set from outside is shown, and what an input method composes is read back when it's done", () => {
  const ref = createRef<MessageInputHandle>();
  const onChange = vi.fn();
  const { container, rerender } = render(<MessageInput ref={ref} value="one" onChange={onChange} label="Message" />);
  const box = container.querySelector<HTMLElement>(".mi")!;
  rerender(<MessageInput ref={ref} value="**two**" onChange={onChange} label="Message" />);
  expect(box.querySelector("b")?.textContent).toBe("two");
  box.focus();
  fireEvent.compositionStart(box);
  box.lastElementChild!.append("か"); // the browser writes into the box itself while composing
  box.dispatchEvent(new InputEvent("beforeinput", { inputType: "insertCompositionText", data: "か", bubbles: true, cancelable: true }));
  expect(onChange).not.toHaveBeenCalled();
  fireEvent.compositionEnd(box);
  expect(onChange).toHaveBeenLastCalledWith("**two**か");
});

test("files and folders are told apart by what they are, for their colour", () => {
  expect([kindOf("src", true), kindOf("node_modules", true), kindOf(".github", true), kindOf("__tests__", true), kindOf("docs", true), kindOf("public", true), kindOf("scripts", true), kindOf("whatever", true)])
    .toEqual(["code", "dim", "config", "test", "doc", "media", "script", "folder"]);
  expect([kindOf("App.tsx", false), kindOf("index.js", false), kindOf("App.test.tsx", false), kindOf("package.json", false), kindOf("README.md", false), kindOf("styles.css", false), kindOf("index.html", false)])
    .toEqual(["ts", "js", "test", "data", "doc", "style", "markup"]);
  expect([kindOf("logo.png", false), kindOf("deploy.sh", false), kindOf("Dockerfile", false), kindOf("main.py", false), kindOf("package-lock.json", false), kindOf(".gitignore", false), kindOf("vite.config.ts", false), kindOf("notes", false)])
    .toEqual(["media", "script", "script", "code", "data", "config", "ts", "file"]);
});

test("Enter in a code block: the box takes it, closes a new block, and hands Enter back once you're out", () => {
  const { h, type, box } = setup();
  type("```");
  expect(h().inCode()).toBe(true);
  let took = false;
  act(() => { took = h().enterInCode(); });
  expect(took).toBe(true);
  expect(h().value).toBe("```\n\n```\n");
  expect(h().selectionStart).toBe(4);                         // on the empty line between
  // The ``` lines are in the text but out of sight, now the cursor isn't on one.
  expect([...box.children].map((c) => c.className)).toEqual(["mi-line mi-pre mi-fence mi-pre-top", "mi-line mi-pre", "mi-line mi-pre mi-fence mi-pre-end", "mi-line"]);
  type("x");
  act(() => { h().enterInCode(); });
  expect(h().value).toBe("```\nx\n\n```\n");
  act(() => h().setSelectionRange(h().value.length, h().value.length)); // below the block
  act(() => { took = h().enterInCode(); });
  expect(took).toBe(false);                                   // not in code: Enter is the owner's (it sends)
  expect(h().value).toBe("```\nx\n\n```\n");
});

test("```code``` on one line is inline code, and Enter stays the owner's", () => {
  const { h, type, box } = setup();
  type("```npm test```");
  expect(box.querySelector("code")?.textContent).toBe("npm test");
  expect(h().inCode()).toBe(false);
  let took = true;
  act(() => { took = h().enterInCode(); });
  expect(took).toBe(false);
});

test("a marker that has taken effect is out of sight, and the cursor is never left inside one", () => {
  const { box, h, type, input, at } = setup();
  type("`test`");
  expect(box.textContent).toBe("`test`");                     // the ticks are still in the text…
  expect([...box.querySelectorAll(".mi-hide")].map((m) => m.textContent)).toEqual(["`", "`"]); // …kept out of sight
  const s = getSelection()!;
  expect((s.focusNode as Element).className).toBe("mi-line"); // the cursor sits after the code, not in the hidden tick
  expect(h().selectionStart).toBe(6);
  type("!");
  expect(h().value).toBe("`test`!");
  at(0);
  expect((getSelection()!.focusNode as Element).className).toBe("mi-line"); // before the code, not in its opening tick
  at(1);
  expect(getSelection()!.focusNode?.parentElement?.tagName).toBe("CODE");   // just inside it
  type(">");
  expect(h().value).toBe("`>test`!");
  at(7);
  input("deleteContentBackward");                             // the closing tick goes: it's code no longer, and the tick left is plain to see
  expect(h().value).toBe("`>test!");
  expect(box.querySelector("code")).toBeNull();
  expect(box.querySelector(".mi-hide")).toBeNull();
});

test("a block's ``` lines show only while the cursor is on them; Backspace at the start of its code unwraps it", () => {
  const { box, h, at, input, key } = setup("```js\nlet a;\n```\nafter");
  const fences = () => [...box.querySelectorAll(".mi-fence")].map((l) => l.classList.contains("on"));
  at(8);
  expect(fences()).toEqual([false, false]);
  at(3);                                                      // onto the opening line
  expect(fences()).toEqual([true, false]);
  at(16);                                                     // onto the closing line
  expect(fences()).toEqual([false, true]);
  at(6);                                                      // the start of the code
  input("deleteContentBackward");
  expect(h().value).toBe("let a;\nafter");
  expect(box.querySelector(".mi-pre")).toBeNull();
  key("z");
  expect(h().value).toBe("```js\nlet a;\n```\nafter");
  at(17);                                                     // the start of the line below the block
  input("deleteContentBackward");
  expect(h().value).toBe("```js\nlet a;\n```\nafter");       // left alone
});

test("the down arrow leaves a block that ends the message", () => {
  const { box, h, at } = setup("```\nlet a;\n```");
  at(7);
  fireEvent.keyDown(box, { key: "ArrowDown" });
  expect(h().value).toBe("```\nlet a;\n```\n");
  expect(h().selectionStart).toBe(15);
  expect(h().inCode()).toBe(false);
});
