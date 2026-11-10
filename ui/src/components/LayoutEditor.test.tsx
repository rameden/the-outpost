// The page drawn from a layout, and the editor that arranges it: zones show their parts, ones
// that are switched off take no room, lines resize, and the editor adds, removes and reassigns.
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { useState } from "react";
import { afterEach, expect, test, vi } from "vitest";
import { defaultLayout, zoneOf, zonesOf, type Item, type Layout } from "../layout.ts";
import { LayoutEditor } from "./LayoutEditor.tsx";
import { LayoutFrame, type ZoneState } from "./Zones.tsx";

afterEach(cleanup);

const show = (n: Item): string => {
  const size = "px" in n.size ? `:${n.size.px}` : "grow" in n.size ? (n.size.grow === 1 ? "" : `*${n.size.grow}`) : ":auto";
  return n.kind === "zone" ? `${n.part ?? "empty"}${size}` : `${n.dir}(${n.items.map(show).join(" ")})${size}`;
};

function page(layout: Layout, states: Record<string, ZoneState> = {}, onChange = vi.fn()) {
  const r = render(
    <LayoutFrame layout={layout} onChange={onChange} className="zones" stateOf={(z) => states[z.part ?? ""] ?? "shown"}>
      {(z, state) => <div>{z.part ?? "nothing"}{state === "collapsed" ? " (tab)" : ""}</div>}
    </LayoutFrame>,
  );
  return { ...r, onChange };
}
const zone = (c: HTMLElement, part: string) => c.querySelector<HTMLElement>(`[data-part="${part}"]`)!;

test("the page is drawn from the layout: each zone in its place, with its size", () => {
  const { container } = page(defaultLayout());
  expect([...container.querySelectorAll(".zone")].map((z) => z.textContent)).toEqual(["roster", "history", "chat", "files", "terminal"]);
  expect(container.querySelector(".zones")?.className).toContain("col");
  expect(zone(container, "history").style.flex).toBe("0 1 272px");
  expect(zone(container, "chat").style.flex).toBe("1 1 0px");
  expect(zone(container, "roster").style.flex).toBe("0 0 auto");
  expect(zone(container, "history").dataset.in).toBe("row");
  expect(container.querySelectorAll(".zone-line.drag").length).toBe(4);
});

test("a part that's switched off takes no room, and one closed to a tab can't be dragged", () => {
  const { container } = page(defaultLayout(), { terminal: "hidden", files: "collapsed" });
  expect(zone(container, "terminal")).toBeNull();
  expect(zone(container, "files").textContent).toBe("files (tab)");
  expect(zone(container, "files").style.flex).toBe("0 0 auto");
  expect(container.querySelectorAll(".zone-line.drag").length).toBe(2); // roster | row, history | chat
  expect(container.querySelectorAll(".zone-line").length).toBe(3);
});

test("when nothing on show shares the leftover space, the last zone takes it", () => {
  const l = defaultLayout();
  l.items[1] = { kind: "zone", id: "z9", part: null, size: { px: 400 } };
  const { container } = page(l, { terminal: "hidden" });
  expect(zone(container, "empty").style.flex).toBe("1 1 0px");
});

test("the line between two zones resizes them, by dragging or with the arrow keys", () => {
  const { container, onChange } = page(defaultLayout());
  const line = zone(container, "history").nextElementSibling as HTMLElement;
  expect(line.getAttribute("aria-orientation")).toBe("vertical");
  const box = (w: number) => () => ({ width: w, height: 600, top: 0, left: 0, right: w, bottom: 600, x: 0, y: 0, toJSON() {} });
  zone(container, "history").getBoundingClientRect = box(272);
  zone(container, "chat").getBoundingClientRect = box(800);
  fireEvent.keyDown(line, { key: "ArrowRight" });
  expect(show(onChange.mock.lastCall![0])).toContain("row(history:288 chat files:300)");
  fireEvent.keyDown(line, { key: "ArrowUp" }); // not this line's direction
  expect(onChange).toHaveBeenCalledTimes(1);

  fireEvent.pointerDown(line, { clientX: 272 });
  fireEvent(window, new MouseEvent("pointermove", { clientX: 372 }));
  expect(show(onChange.mock.lastCall![0])).toContain("row(history:372 chat files:300)");
  fireEvent(window, new MouseEvent("pointerup"));
  fireEvent(window, new MouseEvent("pointermove", { clientX: 500 }));
  expect(onChange).toHaveBeenCalledTimes(2);
});

// The editor over a layout it can change, as the page uses it.
function editor(start = defaultLayout(), select?: string) {
  const seen: Layout[] = [];
  const onClose = vi.fn();
  function Host() {
    const [layout, setLayout] = useState(start);
    seen.push(layout);
    return <LayoutEditor layout={layout} onChange={setLayout} onClose={onClose} select={select} />;
  }
  render(<Host />);
  return { now: () => seen[seen.length - 1], onClose };
}
const mapZone = (name: string) => screen.getByRole("button", { name: `${name} zone` });
const showsSelect = () => screen.getByLabelText("This zone shows") as HTMLSelectElement;

test("the editor maps the zones, and starts on chat", () => {
  editor();
  const map = document.querySelector<HTMLElement>(".layout-map")!;
  expect(within(map).getAllByRole("button").map((b) => b.textContent)).toEqual(["Agent roster", "History", "Chat", "Files", "Terminal"]);
  expect(mapZone("Chat").getAttribute("aria-pressed")).toBe("true");
  expect(showsSelect().value).toBe("chat");
  expect((screen.getByRole("button", { name: "Remove zone" }) as HTMLButtonElement).disabled).toBe(true);
  expect((within(showsSelect()).getByRole("option", { name: "Nothing (empty)" }) as HTMLOptionElement).disabled).toBe(true);
});

test("pick a zone and change what it shows; a part that's elsewhere trades places", () => {
  const { now } = editor();
  fireEvent.click(mapZone("Files"));
  expect(showsSelect().value).toBe("files");
  fireEvent.change(showsSelect(), { target: { value: "history" } });
  expect(show(now())).toContain("row(files:272 chat history:300)");
  fireEvent.change(showsSelect(), { target: { value: "" } });
  expect(show(now())).toContain("row(files:272 chat empty:300)");
  expect(screen.getByText("History", { selector: "b" })).toBeTruthy(); // listed as not on the page
});

test("add a zone beside one, say what goes in it, and remove it again", () => {
  const { now } = editor();
  fireEvent.click(mapZone("History"));
  fireEvent.click(screen.getByRole("button", { name: "Add a zone below" }));
  expect(show(now())).toContain("row(col(history empty):272 chat files:300)");
  expect(mapZone("Empty").getAttribute("aria-pressed")).toBe("true"); // the new one is picked
  fireEvent.change(showsSelect(), { target: { value: "terminal" } });
  expect(show(now())).toBe("col(roster:auto row(col(history terminal):272 chat files:300) empty:280)");
  fireEvent.click(screen.getByRole("button", { name: "Remove zone" }));
  expect(show(now())).toBe("col(roster:auto row(history:272 chat files:300) empty:280)");
  expect(zonesOf(now()).length).toBe(5);
});

test("a zone's size can be switched between fixed, shared and fitted", () => {
  const { now } = editor();
  fireEvent.click(mapZone("History"));
  const size = screen.getByLabelText("Its size") as HTMLSelectElement;
  expect(size.value).toBe("px");
  fireEvent.change(size, { target: { value: "grow" } });
  expect(show(now())).toContain("row(history chat files:300)");
  fireEvent.change(size, { target: { value: "px" } });
  expect(show(now())).toContain("row(history:280 chat"); // nothing on the page to measure here
});

test("reset goes back to the default, and Done or Escape closes it", () => {
  const start = defaultLayout();
  const { now, onClose } = editor(zoneOf(start, "files") ? { ...start, items: [start.items[1]] } : start, "z4");
  expect(mapZone("Files").getAttribute("aria-pressed")).toBe("true"); // opened on the zone asked for
  fireEvent.click(screen.getByRole("button", { name: "Reset" }));
  expect(show(now())).toBe(show(defaultLayout()));
  fireEvent.click(screen.getByRole("button", { name: "Done" }));
  fireEvent.keyDown(document, { key: "Escape" });
  expect(onClose).toHaveBeenCalledTimes(2);
});
