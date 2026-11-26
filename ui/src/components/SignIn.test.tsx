// The page a browser with no key sees: it names the places in the app as the app names them.
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, expect, test } from "vitest";
import { SignIn } from "./SignIn.tsx";

afterEach(cleanup);

test("a browser with no key is told it isn't signed in, and that it needs a one-use link", () => {
  render(<SignIn />);
  const page = screen.getByRole("main");
  expect(within(page).getByRole("heading", { level: 1 }).getAttribute("aria-label")).toMatch(/^Outpost /);
  expect(page.textContent).toContain("This browser isn't signed in to the camp.");
  expect(page.textContent).toContain("You need a sign-in link. Each one works once.");
  expect(page.textContent).toContain("After you've signed in, this address opens by itself in this browser.");
});

test("the two ways in name the places as the app does: the terminal's link, and Settings, Devices & uploads, Make a sign-in link", () => {
  render(<SignIn />);
  const ways = screen.getAllByRole("listitem");
  expect(ways).toHaveLength(2);

  expect(ways[0].textContent).toMatch(/^On the camp's own machine: open the link it printed in its terminal when it started\./);
  expect(ways[0].textContent).toContain("Press Enter in that terminal for a new one.");

  // The same words as the Settings page and its button, so they can be found.
  expect(ways[1].textContent).toMatch(/^From a phone or another computer: in a browser that's already signed in, open Settings, Devices & uploads and press Make a sign-in link\./);
  expect(within(ways[1]).getByText("Make a sign-in link").tagName).toBe("B");
  expect(ways[1].textContent).toContain("scripts/relay/relay.sh link");
  expect(ways[1].textContent).toContain("scripts/tailscale.sh link");
  expect(ways[1].textContent).toContain("These links last ten minutes.");
  // The old names for that page are gone.
  expect(screen.getByRole("main").textContent).not.toMatch(/Other devices|Remote access|Pair a device/);
});

test("nothing of the camp is on the page: no links, buttons or fields", () => {
  render(<SignIn />);
  const page = screen.getByRole("main");
  expect(within(page).queryAllByRole("link")).toHaveLength(0);
  expect(within(page).queryAllByRole("button")).toHaveLength(0);
  expect(within(page).queryAllByRole("textbox")).toHaveLength(0);
});
