// "Is it paying off?" on a project's page: each kind of checking in plain words, what came of
// it, and what it used.
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import type { Payoff } from "../types.ts";
import { PayoffSection, payoffRows } from "./Payoff.tsx";

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
const none = { runs: 0, cost: 0 };
const P: Payoff = {
  days: 30, conversations: 4, total: 10, checkingShare: 40,
  usage: { work: { runs: 12, cost: 6 }, review: { runs: 3, cost: 2 }, opinion: { runs: 1, cost: 0.5 }, fixup: { runs: 2, cost: 1.5 }, feedback: none, chronicle: none },
  reviews: { asked: 3, findings: 5, blockers: 2, sentBack: 2, clean: 1 }, opinions: 1, fixups: 2,
  prs: { seen: 3, merged: 2, open: 1, feedbackRounds: 0, medianHoursToPr: 5.4 }, ratings: { up: 6, down: 1 },
};

test("each line says what was used, what came of it, and what it cost", () => {
  expect(payoffRows(P)).toEqual([
    { what: "The work itself", came: "12 runs across 4 conversations", cost: 6 },
    { what: "Reviews you asked for", came: "3 reviews: 5 findings (2 must fix), sent back to be fixed 2 times; 1 found nothing", cost: 2 },
    { what: "Second opinions", came: "1 asked for", cost: 0.5 },
    { what: "Failed checks sent back", came: "2 times a crew member was sent back to fix what its change broke", cost: 1.5 },
    { what: "Pull requests", came: "3 opened, 2 merged, 1 still open, typically about 5 hours from the first message to the pull request", cost: null },
    { what: "Your ratings", came: "6 good, 1 not what you wanted", cost: null },
  ]);
  const quiet = payoffRows({ ...P, reviews: { asked: 2, findings: 3, blockers: 0, sentBack: 0, clean: 0 }, prs: { ...P.prs, medianHoursToPr: 0.4 } });
  expect(quiet[1].came).toBe("2 reviews: 3 findings, none sent back");
  expect(quiet[4].came).toMatch(/typically under an hour/);
});

test("the section shows the lines and the share that went on checking; with only the work itself, it stays away", async () => {
  let answer: Payoff = P;
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(answer))));
  const { rerender, container } = render(<PayoffSection project={{ id: "p1" }} reloadKey="1" estimated />);
  expect(await screen.findByText("Is it paying off? · last 30 days")).toBeTruthy();
  expect(screen.getByRole("rowheader", { name: "Reviews you asked for" })).toBeTruthy();
  expect(screen.getByText(/40% of this project's usage went on checking the work/).textContent).toMatch(/estimates at API prices/);
  answer = { ...P, reviews: { asked: 0, findings: 0, blockers: 0, sentBack: 0, clean: 0 }, opinions: 0, fixups: 0, prs: { seen: 0, merged: 0, open: 0, feedbackRounds: 0, medianHoursToPr: null }, ratings: { up: 0, down: 0 },
    usage: { ...P.usage, review: none, opinion: none, fixup: none } };
  rerender(<PayoffSection project={{ id: "p1" }} reloadKey="2" estimated />);
  await waitFor(() => expect(container.textContent).toBe(""));
});
