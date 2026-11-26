// The form for a scheduled job: a new one, or an edit of one that's there. Saving it is your
// say-so for its script (jobs.ts keeps a note of what you approved), so a script only ever runs as
// you last saw it here or on the crew's "schedule this?" card.

import { useState } from "react";
import { api, errorText } from "../api.ts";
import type { CampState } from "../types.ts";
import { w } from "../words.ts";

export type JobRow = CampState["jobs"][number];

// The zones a browser knows, for the field's suggestions. An old browser offers none: any name can still be typed.
const ZONES: string[] = (() => {
  try { return (Intl as unknown as { supportedValuesOf?: (k: string) => string[] }).supportedValuesOf?.("timeZone") ?? []; } catch { return []; }
})();

export function JobForm({ S, job, done }: { S: CampState; job?: JobRow; done: () => void }) {
  const [name, setName] = useState(job?.name ?? "");
  const [schedule, setSchedule] = useState(job?.schedule ?? "");
  const [timezone, setTimezone] = useState(job?.timezone ?? "");
  const [task, setTask] = useState(job?.task ?? "");
  const [script, setScript] = useState(job?.script ?? "");
  const [noAgent, setNoAgent] = useState(!!job?.noAgent);
  const [skipExit, setSkipExit] = useState(job?.skipExit ? String(job.skipExit) : "");
  const [contextFrom, setContextFrom] = useState<string[]>(job?.contextFrom ?? []);
  const [watch, setWatch] = useState((job?.watch ?? []).join(", "));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const others = S.jobs.filter((j) => j.name !== (job?.name ?? name));
  const hasScript = !!script.trim();

  async function save(ev: React.FormEvent) {
    ev.preventDefault();
    setBusy(true); setError("");
    try {
      await api("/api/jobs", { action: "save", job: {
        name: name.trim(), schedule: schedule.trim(), timezone: timezone.trim(), task: task.trim(), script: script.trim(),
        noAgent: hasScript && noAgent, skipExit: hasScript ? skipExit.trim() : "",
        contextFrom: contextFrom.filter((n) => others.some((j) => j.name === n)),
        watch: watch.split(",").map((p) => p.trim()).filter(Boolean),
      } });
      done();
    } catch (e) { setError(errorText(e)); }
    setBusy(false);
  }

  return (
    <form className="card trigger-form job-form" onSubmit={save} aria-label={job ? `Edit the job ${job.name}` : "A new job"}>
      <label>Name <input id="job-name" value={name} placeholder="morning-digest" disabled={!!job} onChange={(ev) => setName(ev.target.value)} /></label>
      <label>When
        <input id="job-schedule" value={schedule} placeholder="weekdays 08:00" spellCheck={false} onChange={(ev) => setSchedule(ev.target.value)} />
        <small>every 30m · every 2h · daily 08:00 · weekdays 08:00 · or a cron line, like <code>*/15 9-17 * * 1-5</code> (minute hour day month weekday). At most every 5 minutes.</small>
      </label>
      <label>Time zone
        <input id="job-timezone" value={timezone} list="job-zones" placeholder="This machine's" spellCheck={false} onChange={(ev) => setTimezone(ev.target.value)} />
        <small>Where a time of day is read, like Europe/London. Empty: this machine's own.</small>
        <datalist id="job-zones">{ZONES.map((z) => <option key={z} value={z} />)}</datalist>
      </label>
      <label>What to do <textarea id="job-task" value={task} placeholder={hasScript && noAgent ? "Nothing: the script is the whole job" : "Summarize what's new in the wiki since the last run."} onChange={(ev) => setTask(ev.target.value)} /></label>
      <label>Script (optional)
        <textarea id="job-script" className="job-script" value={script} spellCheck={false} placeholder="gh pr list --search 'review-requested:@me' --json title,url" onChange={(ev) => setScript(ev.target.value)} />
        <small>A shell command that runs first, in this {w("camp")}'s folder (two minutes at most). What it prints is added to the task. If it prints nothing, the run is skipped and no model is called. Saving the job approves the script as written here.</small>
      </label>
      {hasScript && <>
        <label className="switch"><input id="job-no-agent" type="checkbox" checked={noAgent} onChange={(ev) => setNoAgent(ev.target.checked)} /> No model: what the script prints is the report</label>
        <label>Exit code that means "nothing to do"
          <input id="job-skip-exit" type="number" min={1} max={255} value={skipExit} placeholder="None" onChange={(ev) => setSkipExit(ev.target.value)} />
          <small>When the script exits with this code the run is skipped quietly. Any other failure is reported.</small>
        </label>
      </>}
      {others.length > 0 && (
        <fieldset className="job-from">
          <legend>Start from the latest report of</legend>
          {others.map((j) => (
            <label className="switch" key={j.name}><input type="checkbox" checked={contextFrom.includes(j.name)}
              onChange={(ev) => setContextFrom((was) => (ev.target.checked ? [...was, j.name] : was.filter((n) => n !== j.name)))} /> {j.name}</label>
          ))}
        </fieldset>
      )}
      <label>Only when these have changed (optional)
        <input id="job-watch" value={watch} placeholder="camp/wiki, links/web/CHANGELOG.md" spellCheck={false} onChange={(ev) => setWatch(ev.target.value)} />
        <small>Files or folders, comma-separated. A run is skipped while nothing in them has changed since the last one.</small>
      </label>
      {error && <div className="meta bad" role="alert">{error}</div>}
      <div className="card-actions"><button type="submit" className="btn small primary" disabled={busy}>{job ? "Save" : "Add job"}</button><button type="button" className="btn small" onClick={done}>Cancel</button></div>
    </form>
  );
}
