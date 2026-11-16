// The world maker: one crew member's world, made your own a setting at a time.
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import { WorldMaker } from "./Maker.tsx";
import { RING_USUAL, anotherMoon, middle, worldsFor, type Custom } from "./worlds.ts";

afterEach(cleanup);
const [scoutsWorld, station] = worldsFor(0, [{ id: "scout", color: [0.5, 0.7, 0.4] }, { id: "artificer", color: [0.9, 0.6, 0.4] }]);

function show(world = scoutsWorld, changed = false) {
  const on = { onChange: vi.fn<(c: Custom) => void>(), onRoll: vi.fn(), onReset: vi.fn() };
  const r = render(<WorldMaker name={world === station ? "Artificer" : "Scout"} world={world} changed={changed} {...on} />);
  return { ...r, ...on, last: () => on.onChange.mock.calls.at(-1)![0] };
}
const slide = (name: string, to: number) => fireEvent.change(screen.getByRole("slider", { name }), { target: { value: String(to) } });

test("it's folded away until it's wanted, and says which sort of world this is", () => {
  const { container } = show();
  const fold = container.querySelector("details.orb-make")!;
  expect(fold.hasAttribute("open")).toBe(false);
  expect(fold.querySelector("summary")!.textContent).toBe("Make Scout's worldtemperate");
  cleanup();
  expect(show(scoutsWorld, true).container.querySelector("summary")!.textContent).toContain("temperate, made your own");
});

test("rings are switched on and off, and widened; moons and satellites are added and taken away one at a time", () => {
  const { onChange, last, rerender, onRoll, onReset } = show();
  expect(screen.queryByRole("slider", { name: "Ring width" })).toBe(null); // no rings yet: nothing to widen
  fireEvent.click(screen.getByRole("switch", { name: "Rings" }));
  expect(last()).toEqual({ ring: RING_USUAL });
  const ringed = { ...scoutsWorld, ring: { ...RING_USUAL } };
  rerender(<WorldMaker name="Scout" world={ringed} changed onChange={onChange} onRoll={onRoll} onReset={onReset} />);
  expect(screen.getByRole("switch", { name: "Rings" }).getAttribute("aria-checked")).toBe("true");
  slide("Ring width", 1.1);
  expect(last().ring!.inner).toBe(RING_USUAL.inner);
  expect(last().ring!.outer).toBeCloseTo(RING_USUAL.inner + 1.1);
  fireEvent.click(screen.getByRole("switch", { name: "Rings" }));
  expect(last()).toEqual({ ring: null });
  // The camp's own Scout has one moon: one more is the next one out, one fewer leaves none.
  const moons = within(screen.getByRole("group", { name: "Moons" }));
  expect(moons.getByText("1")).toBeTruthy();
  fireEvent.click(moons.getByRole("button", { name: "One more: moons" }));
  expect(last().moons).toEqual([...scoutsWorld.moons, anotherMoon(scoutsWorld, 1)]);
  fireEvent.click(moons.getByRole("button", { name: "One fewer: moons" }));
  expect(last().moons).toEqual([]);
  const sats = within(screen.getByRole("group", { name: "Satellites" }));
  fireEvent.click(sats.getByRole("button", { name: "One more: satellites" }));
  expect(last()).toEqual({ sats: 3 });
  fireEvent.click(sats.getByRole("button", { name: "One fewer: satellites" }));
  expect(last()).toEqual({ sats: 1 });
});

test("a count stops at its ends", () => {
  show({ ...scoutsWorld, moons: [], sats: 6 });
  expect((screen.getByRole("button", { name: "One fewer: moons" }) as HTMLButtonElement).disabled).toBe(true);
  expect((screen.getByRole("button", { name: "One more: satellites" }) as HTMLButtonElement).disabled).toBe(true);
  expect((screen.getByRole("button", { name: "One more: moons" }) as HTMLButtonElement).disabled).toBe(false);
});

test("which sort it is, and its sea, cloud, ice and desert; more cloud and more ice are to the right, as you'd expect", () => {
  const { last } = show();
  expect(screen.getByRole("button", { name: "temperate" }).getAttribute("aria-pressed")).toBe("true");
  fireEvent.click(screen.getByRole("button", { name: "ocean" }));
  expect(last()).toEqual({ sort: "ocean", p: middle("ocean") });
  const [sea, cloud, ice, dry] = scoutsWorld.p;
  slide("Sea", 0.6);
  expect(last().p).toEqual([0.6, cloud, ice, dry]);
  slide("Desert", 0.9);
  expect(last().p).toEqual([sea, cloud, ice, 0.9]);
  // To the drawing, more cloud is a lower number (and more ice, ice beginning nearer the equator): the bar is turned round.
  const bar = screen.getByRole("slider", { name: "Cloud" }) as HTMLInputElement;
  slide("Cloud", Number(bar.max));
  expect(last().p![1]).toBeCloseTo(Number(bar.min));
  slide("Ice", Number((screen.getByRole("slider", { name: "Ice" }) as HTMLInputElement).max));
  expect(last().p![2]).toBeCloseTo(0.5);
  slide("Size", 1.3);
  expect(last()).toEqual({ size: 1.3 });
  slide("Spin", -0.2);
  expect(last()).toEqual({ spin: -0.2 });
  slide("Tilt", 0.5);
  expect(last()).toEqual({ tilt: 0.5 });
});

test("rolling this one again and putting it back are theirs to ask for; there's nothing to put back until something's changed", () => {
  const { onRoll, onReset } = show();
  fireEvent.click(screen.getByRole("button", { name: "Roll this one again" }));
  expect(onRoll).toHaveBeenCalledTimes(1);
  expect(screen.queryByRole("button", { name: "Put it back" })).toBe(null);
  cleanup();
  const changed = show(scoutsWorld, true);
  fireEvent.click(screen.getByRole("button", { name: "Put it back" }));
  expect(changed.onReset).toHaveBeenCalledTimes(1);
});

test("the Artificer's is a station, and is built: spokes, a second ring, how big the ring, how long the wings; no seas, rings or moons", () => {
  const { container, last } = show(station);
  expect(container.querySelector("summary")!.textContent).toBe("Build Artificer's stationa station");
  expect(screen.queryByRole("slider", { name: "Sea" })).toBe(null);
  expect(screen.queryByRole("group", { name: "Moons" })).toBe(null);
  expect(screen.queryByRole("switch", { name: "Rings" })).toBe(null);
  fireEvent.click(screen.getByRole("button", { name: "One more: spokes" }));
  expect(last().p).toEqual([5, 1, 0.8, 0.24]);
  fireEvent.click(screen.getByRole("switch", { name: "Second ring" }));
  expect(last().p).toEqual([4, 0, 0.8, 0.24]);
  slide("Wings", 0.3);
  expect(last().p).toEqual([4, 1, 0.8, 0.3]);
  expect(screen.getByRole("group", { name: "Satellites" })).toBeTruthy(); // it has those like anyone
});
