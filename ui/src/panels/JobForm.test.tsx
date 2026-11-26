// The form for a scheduled job: a cron line and its zone, a script that runs first, and other
// jobs' reports to start from.
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import type { CampState } from "../types.ts";
import { JobForm, type JobRow } from "./JobForm.tsx";

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

const row = (over: Partial<JobRow> = {}): JobRow => ({ name: "digest", schedule: "weekdays 08:00", task: "Summarize what's new." , ...over }) as JobRow;
const S = (jobs: JobRow[] = []) => ({ jobs }) as unknown as CampState;
function camp(status = 200, answer: unknown = { ok: true }) {
  const asked: { url: string; body: any }[] = [];
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    asked.push({ url: String(url), body: init?.body ? JSON.parse(String(init.body)) : undefined });
    return new Response(JSON.stringify(answer), { status });
  }));
  return asked;
}
const field = (id: string) => document.getElementById(id) as HTMLInputElement;
const type = (id: string, value: string) => fireEvent.change(field(id), { target: { value } });

test("a new job: a cron line, a zone, a script with its exit code, and another job's report", async () => {
  const asked = camp();
  const done = vi.fn();
  render(<JobForm S={S([row({ name: "fetch-prs" }), row({ name: "digest" })])} done={done} />);
  screen.getByRole("form", { name: "A new job" });
  // The script's own options only appear once there's a script.
  expect(field("job-no-agent")).toBeNull();
  expect(field("job-skip-exit")).toBeNull();

  type("job-name", " review-queue ");
  type("job-schedule", "*/15 9-17 * * 1-5");
  type("job-timezone", "Europe/London");
  type("job-task", "Say which pull requests need me.");
  type("job-script", "gh pr list --json title\n");
  type("job-skip-exit", "3");
  fireEvent.click(screen.getByRole("checkbox", { name: "fetch-prs" }));
  type("job-watch", "camp/wiki, links/web/CHANGELOG.md ,");
  fireEvent.click(screen.getByRole("button", { name: "Add job" }));

  await waitFor(() => expect(done).toHaveBeenCalled());
  expect(asked).toEqual([{ url: "/api/jobs", body: { action: "save", job: {
    name: "review-queue", schedule: "*/15 9-17 * * 1-5", timezone: "Europe/London", task: "Say which pull requests need me.", script: "gh pr list --json title",
    noAgent: false, skipExit: "3", contextFrom: ["fetch-prs"], watch: ["camp/wiki", "links/web/CHANGELOG.md"],
  } } }]);
});

test("editing a job: its fields are filled in, its name is fixed, and it can't start from its own report", async () => {
  const asked = camp();
  const done = vi.fn();
  const job = row({ name: "digest", schedule: "0 8 * * 1-5", timezone: "America/New_York", script: "cat notes.txt", noAgent: true, skipExit: 2, contextFrom: ["fetch-prs"], watch: ["camp/wiki"] });
  render(<JobForm S={S([row({ name: "fetch-prs" }), job])} job={job} done={done} />);
  screen.getByRole("form", { name: "Edit the job digest" });
  expect(field("job-name").disabled).toBe(true);
  expect([field("job-schedule").value, field("job-timezone").value, field("job-script").value, field("job-skip-exit").value, field("job-watch").value])
    .toEqual(["0 8 * * 1-5", "America/New_York", "cat notes.txt", "2", "camp/wiki"]);
  expect(field("job-no-agent").checked).toBe(true);
  expect((screen.getByRole("checkbox", { name: "fetch-prs" }) as HTMLInputElement).checked).toBe(true);
  expect(screen.queryByRole("checkbox", { name: "digest" })).toBeNull();

  fireEvent.click(screen.getByRole("checkbox", { name: "fetch-prs" }));
  fireEvent.click(screen.getByRole("button", { name: "Save" }));
  await waitFor(() => expect(done).toHaveBeenCalled());
  expect(asked[0]!.body.job).toMatchObject({ name: "digest", noAgent: true, skipExit: "2", contextFrom: [], script: "cat notes.txt" });
});

test("taking the script away takes its options with it", async () => {
  const asked = camp();
  const done = vi.fn();
  const job = row({ script: "cat notes.txt", noAgent: true, skipExit: 2 });
  render(<JobForm S={S([job])} job={job} done={done} />);
  type("job-script", "   ");
  expect(field("job-no-agent")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Save" }));
  await waitFor(() => expect(done).toHaveBeenCalled());
  expect(asked[0]!.body.job).toMatchObject({ script: "", noAgent: false, skipExit: "" });
});

test("what the server won't take is said on the form, which stays open", async () => {
  camp(400, { error: "\"every 1m\" is too often: at most every 5 minutes." });
  const done = vi.fn();
  render(<JobForm S={S()} done={done} />);
  type("job-name", "too-often");
  type("job-schedule", "every 1m");
  fireEvent.click(screen.getByRole("button", { name: "Add job" }));
  expect((await screen.findByRole("alert")).textContent).toContain("too often");
  expect(done).not.toHaveBeenCalled();
  expect((screen.getByRole("button", { name: "Add job" }) as HTMLButtonElement).disabled).toBe(false);
});

test("Cancel closes the form and saves nothing", () => {
  const asked = camp();
  const done = vi.fn();
  render(<JobForm S={S()} done={done} />);
  fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
  expect(done).toHaveBeenCalled();
  expect(asked).toEqual([]);
});
