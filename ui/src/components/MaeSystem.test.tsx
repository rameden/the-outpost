// The camp at rest: the crew as planets round the Quartermaster's sun, taking turns with a quest.
import { act, cleanup, render } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { setCrewColors } from "../format.ts";
import { LAPS, MaeSystem, MOST, TURN_MS } from "./MaeSystem.tsx";

const css = readFileSync(join(__dirname, "..", "styles.css"), "utf8");
const moving = (yes: boolean) => vi.stubGlobal("matchMedia", (q: string) => ({ matches: !yes && q.includes("reduce") }));
beforeEach(() => { vi.useFakeTimers(); moving(true); });
afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); setCrewColors([]); });

const who = (container: HTMLElement) => [...container.querySelectorAll(".sys-planet")].map((p) => p.getAttribute("data-who"));
const turn = (container: HTMLElement) => container.querySelector(".sys-planet.sys-on")?.getAttribute("data-who") ?? null;

test("the camp's own four circle the sun, each in their own colour, and it is decoration", () => {
  const { container } = render(<MaeSystem />);
  const svg = container.querySelector("svg.mae-system")!;
  expect(svg.getAttribute("aria-hidden")).toBe("true");
  expect(svg.querySelectorAll(".sys-sun").length).toBe(1);
  // The orbits are contour lines, one for each of the crew and a fainter one beyond: closed, and none a plain circle.
  const lines = [...svg.querySelectorAll("path.sys-ring")];
  expect(lines.length).toBe(5);
  for (const line of lines) expect(line.getAttribute("d")).toMatch(/^M[\d.-]+ [\d.-]+(L[\d.-]+ [\d.-]+){119}Z$/);
  expect(new Set(lines.map((l) => l.getAttribute("d"))).size).toBe(5);
  expect(who(container)).toEqual(["scout", "artificer", "scribe", "warden"]);
  for (const planet of svg.querySelectorAll(".sys-planet")) {
    expect(planet.classList.contains(`c-${planet.getAttribute("data-who")}`)).toBe(true);
    expect(planet.querySelectorAll(".sys-disc").length).toBe(1);
    expect(planet.querySelectorAll(".sys-mark").length).toBe(1);
  }
});

test("a planet sits on its own contour line, and its tail is a stretch of that line", () => {
  const { container } = render(<MaeSystem />);
  [...container.querySelectorAll(".sys-planet")].forEach((planet, i) => {
    const r = 42 + 22 * i, turning = planet.querySelector(".sys-orbit")!;
    // The line turns with the planet (they are in the one turning group), and starts exactly where the planet is.
    const line = turning.querySelector(":scope > path.sys-ring")!.getAttribute("d")!;
    expect(line.startsWith(`M${r}.0 0.0L`)).toBe(true);
    expect(turning.querySelector(":scope > g")!.getAttribute("transform")).toMatch(new RegExp(`^translate\\(${r} 0\\)`));
    // Each tail is that same line with only its last stretch drawn: the stretch that ends at the planet.
    const tails = [...turning.querySelectorAll(":scope > path.sys-tail")];
    expect(tails.length).toBe(3);
    const lengths = tails.map((t) => {
      expect(t.getAttribute("d")).toBe(line);
      expect(t.getAttribute("pathLength")).toBe("1000");
      const [drawn, left] = t.getAttribute("stroke-dasharray")!.split(" ").map(Number);
      expect(drawn + left).toBe(1000);
      expect(t.getAttribute("stroke-dashoffset")).toBe(String(drawn));
      return drawn;
    });
    expect(lengths[0]).toBeGreaterThan(lengths[1]);
    expect(lengths[1]).toBeGreaterThan(lengths[2]);
    expect(lengths[0]).toBeLessThan(250); // a tail, not most of a lap
  });
  // Only the line beyond the last planet has nobody on it, so only that one drifts by itself.
  expect(container.querySelectorAll(".sys-drift").length).toBe(1);
});

test("a planet's mark is turned back by as much as its orbit turns it, so it stays upright", () => {
  const { container } = render(<MaeSystem />);
  for (const planet of container.querySelectorAll(".sys-planet")) {
    const start = Number(planet.getAttribute("transform")!.match(/^rotate\((-?[\d.]+)\)$/)![1]);
    const orbit = planet.querySelector(".sys-orbit")!, upright = planet.querySelector(".sys-upright")!;
    expect(upright.parentElement!.getAttribute("transform")).toMatch(new RegExp(`rotate\\(${-start}\\)$`));
    // The two turn in the same time: they share the class that sets it.
    const pace = [...orbit.classList].find((c) => /^sys-o\d$/.test(c));
    expect(pace).toBeTruthy();
    expect(upright.classList.contains(pace!)).toBe(true);
  }
});

test("someone you added joins the rotation on the next orbit out, in the colour you gave them", () => {
  const crew = [
    { id: "scout", name: "Scout", emoji: "🏹", role: "" }, { id: "artificer", name: "Artificer", emoji: "🔨", role: "" },
    { id: "scribe", name: "Scribe", emoji: "🪶", role: "" }, { id: "warden", name: "Warden", emoji: "🛡️", role: "" },
    { id: "hacker", name: "Hacker", emoji: "⚡", role: "", custom: true, color: "rose" },
    { id: "cook", name: "Cook", emoji: "🍳", role: "", custom: true, color: "teal" },
  ];
  setCrewColors(crew);
  const { container } = render(<MaeSystem crew={crew} />);
  expect(who(container)).toEqual(["scout", "artificer", "scribe", "warden", "hacker", "cook"]);
  const svg = container.querySelector("svg")!;
  expect(svg.classList.contains("sys-n6")).toBe(true); // wider, so the planets stay the same size
  expect(svg.querySelectorAll("path.sys-ring").length).toBe(7);
  const hacker = svg.querySelector('[data-who="hacker"]')!;
  expect(hacker.classList.contains("c-x-rose")).toBe(true);
  expect(hacker.querySelector(".sys-orbit")!.classList.contains("sys-o5")).toBe(true);
  expect(hacker.querySelectorAll(".sys-mark").length).toBe(1); // the Hacker has a mark of their own
  // Anyone else shows their emoji.
  const cook = svg.querySelector('[data-who="cook"]')!;
  expect(cook.classList.contains("c-x-teal")).toBe(true);
  expect(cook.querySelector(".sys-emoji")!.textContent).toBe("🍳");
  // The stylesheet has a pace, a reach and a width for every orbit it can be asked to draw.
  for (let n = 1; n <= MOST; n++) expect(css).toMatch(new RegExp(`\\.sys-o${n} \\{ animation-duration: ${LAPS[n - 1]}s; --r: ${42 + 22 * (n - 1)}px; \\}`)); // (LAPS: the same paces, for the full-screen view)
  for (let n = 5; n <= MOST; n++) expect(css).toMatch(new RegExp(`\\.mae-system\\.sys-n${n} \\{ width: \\d+px;`));
});

test("the crew take turns with a quest: one at a time, in order, and round again", () => {
  const { container } = render(<MaeSystem />);
  expect(turn(container)).toBe(null); // nobody yet
  act(() => { vi.advanceTimersByTime(1000); });
  expect(turn(container)).toBe("scout");
  // Their contour line lights up, a comet and a moon are theirs to send, and the sun's ring waits for the report.
  expect(container.querySelectorAll(".sys-on .sys-tone").length).toBe(1);
  expect(container.querySelectorAll(".sys-planet.sys-on .sys-comet").length).toBe(4);
  expect(container.querySelectorAll(".sys-planet.sys-on .sys-moon").length).toBe(1);
  expect(container.querySelector(".sys-ping")!.classList.contains("sys-on")).toBe(true);
  // The sun's ring lights every line as it passes: each line has its flash, one line later than the last, drawn afresh for each ring.
  const flashes = () => [...container.querySelectorAll("path.sys-lit.sys-on")];
  expect(flashes().map((f) => [...f.classList].find((c) => /^sys-l\d$/.test(c)))).toEqual(["sys-l5", "sys-l1", "sys-l2", "sys-l3", "sys-l4"]);
  const before = flashes();
  const order = [];
  for (let i = 0; i < 5; i++) { act(() => { vi.advanceTimersByTime(TURN_MS); }); order.push(turn(container)); }
  expect(order).toEqual(["artificer", "scribe", "warden", "scout", "artificer"]);
  expect(container.querySelectorAll(".sys-on.sys-planet").length).toBe(1);
  expect(flashes().length).toBe(5);
  expect(flashes().some((f) => before.includes(f))).toBe(false);
  const waits = [1, 2, 3, 4, 5, 6, 7, 8].map((l) => Number(css.match(new RegExp(`\\.sys-lit\\.sys-l${l} \\{ animation-delay: ([\\d.]+)s; \\}`))![1]));
  expect(waits).toEqual([...waits].sort((a, b) => a - b));
  expect(new Set(waits).size).toBe(8);
  // A turn's animations are as long as a turn.
  expect(TURN_MS).toBe(8000);
  for (const rule of [".sys-on .sys-comet { animation: sys-quest 8s", ".sys-on .sys-pulse { animation: sys-land 8s", ".sys-ping.sys-on { animation: sys-home 8s"]) expect(css).toContain(rule);
});

test("with no crew the lines are empty, and the sun sends a ring out by itself", () => {
  const { container } = render(<MaeSystem crew={[]} />);
  expect(container.querySelectorAll("path.sys-ring").length).toBe(5);
  expect(container.querySelectorAll(".sys-planet").length).toBe(0);
  expect(container.querySelector(".sys-ping")!.classList.contains("sys-alone")).toBe(true);
  expect(container.querySelectorAll("path.sys-lit.sys-alone").length).toBe(5); // and that ring lights the lines too
  expect(container.querySelectorAll(".sys-drift").length).toBe(5);
  act(() => { vi.advanceTimersByTime(30_000); });
  expect(container.querySelectorAll(".sys-on").length).toBe(0);
});

test("for less motion it rests: nobody takes a turn, and the stylesheet stops the rest", () => {
  moving(false);
  const { container } = render(<MaeSystem />);
  act(() => { vi.advanceTimersByTime(30_000); });
  expect(turn(container)).toBe(null);
  expect(css).toMatch(/@media \(prefers-reduced-motion: reduce\) \{ \.mae-system \* \{ animation: none; \} \}/);
  expect(css).toMatch(/\.sys-drift \{ animation: sys-turn \d+s linear infinite; \}/); // otherwise the contour lines drift
});
