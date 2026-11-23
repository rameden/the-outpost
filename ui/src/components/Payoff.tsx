// "Is it paying off?", on a project's page: over the last month, what the checking around the
// work (reviews, second opinions, sending a failed check back) turned up, what it used, and how
// the project's pull requests went. Counted from the camp's own record. It's here so you can
// switch off what isn't earning its keep.

import { useEffect, useState } from "react";
import { api } from "../api.ts";
import { leadName, money, plural } from "../format.ts";
import type { Payoff } from "../types.ts";

import { a as an } from "../words.ts";
// One line per thing, in plain words: what it was used for, what came of it, what it used.
export function payoffRows(p: Payoff): { what: string; came: string; cost: number | null }[] {
  const rows: { what: string; came: string; cost: number | null }[] = [];
  const u = p.usage;
  if (u.work.runs) rows.push({ what: "The work itself", came: `${u.work.runs} ${plural(u.work.runs, "run")} across ${p.conversations} ${plural(p.conversations, "conversation")}`, cost: u.work.cost });
  if (p.reviews.asked || u.review.runs) {
    const r = p.reviews;
    rows.push({ what: "Reviews you asked for", cost: u.review.cost,
      came: !r.asked ? "none finished" : `${r.asked} ${plural(r.asked, "review")}: ${r.findings} ${plural(r.findings, "finding")}${r.blockers ? ` (${r.blockers} must fix)` : ""}` +
        `${r.sentBack ? `, sent back to be fixed ${r.sentBack === 1 ? "once" : `${r.sentBack} times`}` : r.findings ? ", none sent back" : ""}${r.clean ? `; ${r.clean} found nothing` : ""}` });
  }
  if (p.opinions || u.opinion.runs) rows.push({ what: "Second opinions", came: `${p.opinions} asked for`, cost: u.opinion.cost });
  if (p.fixups) rows.push({ what: "Failed checks sent back", came: `${p.fixups} ${plural(p.fixups, "time")} ${an("crew")} member was sent back to fix what its change broke`, cost: u.fixup.cost });
  if (u.feedback.runs || p.prs.feedbackRounds) rows.push({ what: "Pull request feedback", came: `${p.prs.feedbackRounds} ${plural(p.prs.feedbackRounds, "round")} brought in and answered`, cost: u.feedback.cost });
  if (u.chronicle.runs) rows.push({ what: "Chronicles", came: `${u.chronicle.runs} written`, cost: u.chronicle.cost });
  if (p.prs.seen) {
    const h = p.prs.medianHoursToPr;
    const took = h === null ? "" : h < 1 ? ", typically under an hour from the first message to the pull request" : h < 48 ? `, typically about ${Math.round(h)} ${plural(Math.round(h), "hour")} from the first message to the pull request` : `, typically about ${Math.round(h / 24)} days from the first message to the pull request`;
    rows.push({ what: "Pull requests", came: `${p.prs.seen} opened, ${p.prs.merged} merged, ${p.prs.open} still open${took}`, cost: null });
  }
  if (p.ratings.up || p.ratings.down) rows.push({ what: "Your ratings", came: `${p.ratings.up} good, ${p.ratings.down} not what you wanted`, cost: null });
  return rows;
}

export function PayoffSection({ project, reloadKey, estimated }: { project: { id: string }; reloadKey: string; estimated: boolean }) {
  const [p, setP] = useState<Payoff | null>(null);
  useEffect(() => {
    let current = true;
    api<Payoff>(`/api/project/payoff?id=${encodeURIComponent(project.id)}`).then((d) => { if (current) setP(d); }, () => { if (current) setP(null); });
    return () => { current = false; };
  }, [project.id, reloadKey]);
  if (!p?.usage) return null;
  const rows = payoffRows(p);
  if (rows.length < 2) return null; // only the work itself: nothing to weigh yet
  return (
    <section>
      <div className="section-label">Is it paying off? · last {p.days} days</div>
      <table className="payoff">
        <tbody>
          {rows.map((r) => <tr key={r.what}><th scope="row">{r.what}</th><td>{r.came}</td><td className="payoff-cost">{r.cost === null ? "" : money(r.cost)}</td></tr>)}
        </tbody>
      </table>
      {p.total > 0 && (
        <div className="meta">{p.checkingShare}% of this project's usage went on checking the work (reviews, second opinions, sent-back checks){estimated ? "; amounts are estimates at API prices" : ""}.
          A review the {leadName()} runs by itself counts under the work. If the checking rarely finds anything, it can be turned down in Settings or in this project's own defaults.</div>
      )}
    </section>
  );
}
