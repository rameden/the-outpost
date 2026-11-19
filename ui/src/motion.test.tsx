// Motion's two helpers: what's leaving stays on the page just long enough to go, and nothing
// waits on an animation when motion is off (a reduced-motion setting, or a page that can't tell).
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { defaultLayout } from "./layout.ts";
import { LayoutFrame, type ZoneState } from "./components/Zones.tsx";
import { glide, LEAVE_MS, motionOK, Presence, useLingering } from "./motion.tsx";

beforeEach(() => vi.useFakeTimers());
afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); });
const motion = (reduce: boolean) => vi.stubGlobal("matchMedia", (q: string) => ({ matches: reduce && q.includes("reduce") }));

function Toggle() {
  const [open, setOpen] = useState(true);
  return (
    <>
      <button onClick={() => setOpen((o) => !o)}>toggle</button>
      <Presence>{open && <div role="dialog">Hello</div>}</Presence>
    </>
  );
}

test("without motion, what's closed is gone at once", () => {
  expect(motionOK()).toBe(false); // this page can't say
  render(<Toggle />);
  fireEvent.click(screen.getByText("toggle"));
  expect(screen.queryByRole("dialog")).toBeNull();
  motion(true); // and so is anyone who asked for less motion
  expect(motionOK()).toBe(false);
  fireEvent.click(screen.getByText("toggle"));
  fireEvent.click(screen.getByText("toggle"));
  expect(screen.queryByRole("dialog")).toBeNull();
});

test("with motion, it stays while it leaves (marked, and out of reach), then goes", () => {
  motion(false);
  const { container } = render(<Toggle />);
  expect(container.querySelector(".presence")?.className).toBe("presence");
  fireEvent.click(screen.getByText("toggle"));
  const holder = container.querySelector(".presence")!;
  expect(holder.className).toBe("presence leaving");
  expect(holder.hasAttribute("inert")).toBe(true);
  expect(holder.textContent).toBe("Hello");
  act(() => { vi.advanceTimersByTime(LEAVE_MS + 10); });
  expect(container.querySelector(".presence")).toBeNull();
});

test("opened again while it's leaving, it simply stays", () => {
  motion(false);
  const { container } = render(<Toggle />);
  fireEvent.click(screen.getByText("toggle"));
  fireEvent.click(screen.getByText("toggle"));
  expect(container.querySelector(".presence")?.className).toBe("presence");
  act(() => { vi.advanceTimersByTime(LEAVE_MS * 2); });
  expect(screen.getByRole("dialog").textContent).toBe("Hello");
});

function Page({ states, animate = true }: { states: Record<string, ZoneState>; animate?: boolean }) {
  return (
    <LayoutFrame layout={defaultLayout()} onChange={() => {}} className="zones" animate={animate} stateOf={(z) => states[z.part ?? ""] ?? "shown"}>
      {(z, state) => <div>{z.part}{state === "collapsed" ? " (tab)" : ""}</div>}
    </LayoutFrame>
  );
}
const zone = (c: HTMLElement, part: string) => c.querySelector<HTMLElement>(`[data-part="${part}"]`);

test("a panel that's switched off slides away before it goes; one switched on slides in", () => {
  motion(false);
  const { container, rerender } = render(<Page states={{}} />);
  expect(zone(container, "terminal")!.className).toBe("zone"); // nothing moves when the page first draws
  rerender(<Page states={{ terminal: "hidden" }} />);
  expect(zone(container, "terminal")!.className).toBe("zone leaving");
  act(() => { vi.advanceTimersByTime(LEAVE_MS + 60); });
  expect(zone(container, "terminal")).toBeNull();
  rerender(<Page states={{}} />);
  expect(zone(container, "terminal")!.className).toBe("zone entering");
  act(() => { vi.advanceTimersByTime(LEAVE_MS + 60); });
  expect(zone(container, "terminal")!.className).toBe("zone");
});

test("closing to a tab: the panel stays until it has slid away, then the tab takes its place", () => {
  motion(false);
  const { container, rerender } = render(<Page states={{}} />);
  rerender(<Page states={{ files: "collapsed" }} />);
  expect(zone(container, "files")!.className).toBe("zone leaving");
  expect(zone(container, "files")!.textContent).toBe("files"); // still the panel until it has gone
  act(() => { vi.advanceTimersByTime(LEAVE_MS + 60); });
  expect(zone(container, "files")!.className).toBe("zone collapsed");
  expect(zone(container, "files")!.textContent).toBe("files (tab)");
  rerender(<Page states={{}} />);
  expect(zone(container, "files")!.className).toBe("zone entering");
  expect(zone(container, "files")!.dataset.edge).toBe("end"); // the right-hand side: it slides in from there
});

test("the map, and anyone without motion, switch at once", () => {
  motion(false);
  const map = render(<Page states={{}} animate={false} />);
  map.rerender(<Page states={{ terminal: "hidden" }} animate={false} />);
  expect(zone(map.container, "terminal")).toBeNull();
  cleanup();
  motion(true);
  const page = render(<Page states={{}} />);
  page.rerender(<Page states={{ terminal: "hidden" }} />);
  expect(zone(page.container, "terminal")).toBeNull();
});

test("gliding: the change is made either way, and what moved slides from where it was, by transform alone", () => {
  const change = vi.fn();
  glide(change, []);
  glide(change, [document.createElement("div")]); // no motion here: just the change
  expect(change).toHaveBeenCalledTimes(2);

  motion(false);
  const box = (top: () => number) => {
    const el = document.createElement("div");
    el.getBoundingClientRect = () => ({ top: top(), left: 0 }) as DOMRect;
    el.animate = vi.fn() as unknown as typeof el.animate;
    return el;
  };
  let open = false;
  const below = box(() => (open ? 143 : 92)), still = box(() => 580), within = document.createElement("div"), bar = box(() => 49);
  glide(() => { open = true; }, [below, still, null], { within, fresh: bar });
  expect(below.animate).toHaveBeenCalledWith([{ transform: "translate(0px, -51px)" }, { transform: "translate(0, 0)" }], expect.objectContaining({ duration: 240 }));
  expect(still.animate).not.toHaveBeenCalled();        // it didn't move
  expect(bar.animate).toHaveBeenCalledWith([{ opacity: 0.25 }, { opacity: 1 }], expect.anything()); // redrawn in place: it fades up
  expect(within.style.overflow).toBe("hidden");        // nothing spills out while they glide
  act(() => { vi.advanceTimersByTime(300); });
  expect(within.style.overflow).toBe("");
});

// A list drawn through useLingering: each thing by name, the ones on their way out marked.
function Row({ list, on = true }: { list: string[]; on?: unknown }) {
  return <ul>{useLingering(list, (x) => x, on, 200).map(({ item, leaving }) => <li key={item}>{leaving ? `(${item})` : item}</li>)}</ul>;
}
const rows = () => screen.getAllByRole("listitem").map((li) => li.textContent).join(" ");

test("what leaves a list stays where it was for a moment, marked as leaving, then goes", () => {
  motion(false);
  const { rerender } = render(<Row list={["a", "b", "c", "d"]} />);
  expect(rows()).toBe("a b c d");
  rerender(<Row list={["a", "c"]} />);
  expect(rows()).toBe("a (b) c (d)"); // each in the place it had
  // Something new joins meanwhile, and one that was leaving comes back: it's simply there again.
  act(() => { vi.advanceTimersByTime(100); });
  rerender(<Row list={["a", "c", "d", "e"]} />);
  expect(rows()).toBe("a (b) c d e");
  rerender(<Row list={["a", "c", "e"]} />);
  expect(rows()).toBe("a (b) c (d) e");
  // b's moment is up first; d left later, so it has longer.
  act(() => { vi.advanceTimersByTime(110); });
  expect(rows()).toBe("a c (d) e");
  act(() => { vi.advanceTimersByTime(100); });
  expect(rows()).toBe("a c e");
  // All of it can go, the first in the list included.
  rerender(<Row list={[]} />);
  expect(rows()).toBe("(a) (c) (e)");
  act(() => { vi.advanceTimersByTime(210); });
  expect(screen.queryAllByRole("listitem")).toHaveLength(0);
});

test("nothing lingers without motion, while it's off, or from before it was switched on", () => {
  const { rerender, unmount } = render(<Row list={["a", "b"]} />); // (the page can't tell here: no motion)
  rerender(<Row list={["a"]} />);
  expect(rows()).toBe("a");
  unmount();

  motion(false);
  const off = render(<Row list={["a", "b"]} on={false} />);
  off.rerender(<Row list={["a"]} on={false} />);
  expect(rows()).toBe("a");
  // Switched on as the list changes under it (a replay starting): what was there before isn't held.
  off.rerender(<Row list={[]} on />);
  expect(screen.queryAllByRole("listitem")).toHaveLength(0);
  off.rerender(<Row list={["x", "y"]} on />);
  off.rerender(<Row list={["x"]} on />);
  expect(rows()).toBe("x (y)");
  // And switched off, what was leaving is gone at once.
  off.rerender(<Row list={["x"]} on={false} />);
  expect(rows()).toBe("x");
  // On for one list, then for another (today's plans, then a replay's): nothing is held across the change.
  off.rerender(<Row list={["x", "y"]} on="today" />);
  off.rerender(<Row list={["p"]} on="replay" />);
  expect(rows()).toBe("p");
  off.rerender(<Row list={[]} on="replay" />);
  expect(rows()).toBe("(p)");
});
