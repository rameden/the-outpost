// The Inbox (Activity → Inbox): the one place that lists everything waiting on you, and where each
// is handled. The header's chip, the sidebar's badge, Today, Memory and the line above the message
// box each show its count (inbox.ts) and lead here; none of them keeps a list of its own.
//
// In the order you'd want to get to them:
//   - decisions the crew is waiting on (approvals and questions), answered on the card;
//   - chained requests that haven't started, to start now or take off (the held ones count);
//   - pull requests with something new, and runs that failed, each opening its conversation;
//   - what the crew proposed to remember, and skills it proposed, to approve or turn down;
//   - runs that finished since you looked, to open or mark seen;
//   - what the latest brief said was waiting on you that isn't already above, with its next step;
//   - reports from scheduled jobs, to read and mark as read.

import { useMemo, useState } from "react";
import { errorText } from "../api.ts";
import { AskCard } from "../feed/AskCard.tsx";
import type { View } from "../feed/conversation.ts";
import { findNodes, type AskNode } from "../feed/reducer.ts";
import { useFeed, type FeedStore } from "../feed/store.ts";
import { leadName, when } from "../format.ts";
import { ACT, briefAct, briefLineFor, briefOnly, inboxLabel, type InboxCount } from "../inbox.ts";
import type { Need } from "../needs.ts";
import { Inbox as Reports, Skills } from "../panels/Records.tsx";
import { useHome } from "../settings/DrivePage.tsx";
import { ProposalCard } from "../settings/MemoryPage.tsx";
import type { BriefLine, CampState } from "../types.ts";
import { w } from "../words.ts";
import { Empty, Icon } from "./bits.tsx";
import { Chained, chainedOf } from "./Waiting.tsx";

export function Inbox({ S, store, refresh, needs, count, onSeenAll, setView, onStartTicket }: {
  S: CampState; store: FeedStore; refresh: () => void;
  needs: Need[]; count: InboxCount; onSeenAll: () => void;
  setView: (v: View) => void; onStartTicket: (t: { key: string; summary: string }) => void;
}) {
  const open = useFeed(store, (s) => s.asks);
  const items = useFeed(store, (s) => s.items);
  const { home } = useHome();
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const go = (conversation: string) => setView({ kind: "conversation", id: conversation });

  // Each open decision: its card, and the conversation it belongs to (when it has one).
  const decisions = useMemo(() => {
    const cards = new Map(findNodes(items, "ask").map((n) => [n.id, n]));
    const thread = new Map(findNodes(items, "exp").filter((x) => x.thread).map((x) => [x.expId, x.thread!]));
    return open.map((a) => ({ ask: a, card: cards.get(a.node) as AskNode | undefined, conversation: a.expId ? thread.get(a.expId) : undefined }));
  }, [open, items]);
  const titleOf = (id?: string) => S.history.conversations.find((c) => c.id === id)?.title;

  const brief = home?.brief?.needs ?? []; // the latest brief's, whichever day it was written
  const fromBrief = briefOnly(brief, needs);
  const act = async (l: BriefLine) => {
    setBusy(l.title); setError("");
    try { await briefAct(l, { open: go, startTicket: onStartTicket }); } catch (e) { setError(errorText(e)); }
    setBusy("");
  };
  const step = (l: BriefLine | undefined, title: string) => l?.act && (
    <button type="button" className="btn small" disabled={busy === l.title} aria-label={busy === l.title ? undefined : `${ACT[l.act.do].replace("…", "")}: ${title}`} onClick={() => void act(l)}>{busy === l.title ? "Starting…" : ACT[l.act.do]}</button>
  );

  const of = (kind: Need["kind"]) => needs.filter((n) => n.kind === kind);
  const prs = of("pr"), failed = of("failed"), finished = of("finished");
  const chained = chainedOf(S), held = chained.filter((q) => q.held).length;
  const proposals = S.memoryProposals ?? [];
  const rows = (list: Need[], label: string) => (
    <ul className="list home-lines inbox-lines" aria-label={label}>
      {list.map((n) => (
        <li className="home-line" key={n.key}>
          <span className="home-line-text">
            <button type="button" className="home-line-title" title="Open its conversation" onClick={() => go(n.conversation)}>{n.title}</button>
            <span className="meta">{n.says}</span>
          </span>
          {step(briefLineFor(n, brief), n.title)}
          <button type="button" className="btn small" aria-label={`Open ${n.title}`} onClick={() => go(n.conversation)}>Open</button>
        </li>
      ))}
    </ul>
  );
  const nothing = !count.total && !chained.length && !fromBrief.length && !S.inbox.length;

  return (
    <div className="inbox-page">
      <p className="panel-note" role="status">
        {count.total ? `${inboxLabel(count)}.` : "Nothing is waiting on you."} Everything that waits on you is listed here, and this is where you answer it.
      </p>
      {error && <div className="form-error" role="alert">{error}</div>}
      {nothing && <Empty title="Inbox is empty">Decisions the {w("crew")} needs from you, pull requests with something new, runs that failed, what the {w("crew")} proposes to remember, and reports from scheduled jobs all land here.</Empty>}

      {decisions.length > 0 && (
        <section aria-label="Decisions">
          <h3 className="inbox-head">Decisions <span className="count needs">{decisions.length}</span></h3>
          <p className="set-note">The {w("crew")} has stopped and is waiting for your answer. Answer here, or open the conversation to see what led to it.</p>
          <ul className="list inbox-asks">
            {decisions.map(({ ask, card, conversation }) => (
              <li key={ask.id}>
                <div className="inbox-ask-from">
                  <span className="meta">{ask.who}{titleOf(conversation) ? ` · ${titleOf(conversation)}` : ""}</span>
                  {conversation && <button type="button" className="linkish" onClick={() => go(conversation)}>Open the conversation</button>}
                </div>
                {card ? <AskCard ask={card} /> : <div className="meta">This decision is in its conversation: open it to answer.</div>}
              </li>
            ))}
          </ul>
        </section>
      )}

      {chained.length > 0 && (
        <section aria-label="Chained requests">
          <h3 className="inbox-head">Chained requests {held > 0 && <span className="count needs">{held}</span>}</h3>
          <p className="set-note">Requests you queued behind other work. One is held when the work before it didn't finish cleanly: start it anyway, or take it off.</p>
          <Chained S={S} refresh={refresh} onOpen={go} />
        </section>
      )}

      {prs.length > 0 && (
        <section aria-label="Pull requests">
          <h3 className="inbox-head">Pull requests <span className="count needs">{prs.length}</span></h3>
          {rows(prs, "Pull requests with something new")}
        </section>
      )}

      {failed.length > 0 && (
        <section aria-label="Runs that didn't finish">
          <h3 className="inbox-head">Runs that didn't finish <span className="count needs">{failed.length}</span></h3>
          {rows(failed, "Runs that didn't finish")}
        </section>
      )}

      {proposals.length > 0 && (
        <section aria-label="Memory">
          <h3 className="inbox-head">Memory <span className="count needs">{proposals.length}</span></h3>
          <p className="set-note">What the {w("crew")} suggests remembering, tidying or merging. Nothing is kept or changed until you approve it; you can edit each one first. <button type="button" className="linkish" onClick={() => setView({ kind: "memory" })}>Open Memory</button></p>
          <ul className="mem-waiting">{proposals.map((p) => <ProposalCard key={p.id} p={p} refresh={refresh} />)}</ul>
        </section>
      )}

      {S.skills.length > 0 && (
        <section aria-label="Skills">
          <h3 className="inbox-head">Skills <span className="count needs">{S.skills.length}</span></h3>
          <Skills S={S} refresh={refresh} />
        </section>
      )}

      {finished.length > 0 && (
        <section aria-label="Finished since you looked">
          <h3 className="inbox-head">Finished since you looked <span className="count">{finished.length}</span>
            <button type="button" className="btn small" onClick={onSeenAll}>Mark what's finished as seen</button>
          </h3>
          {rows(finished, "Finished since you looked")}
        </section>
      )}

      {fromBrief.length > 0 && (
        <section aria-label="From the brief">
          <h3 className="inbox-head">From the brief</h3>
          <p className="set-note">What the brief found waiting on you when it was written{home?.brief ? ` (${when(home.brief.written)})` : ""}, beyond what's above. It isn't counted, since it may have moved on: write the brief again on Today to bring it up to date.</p>
          <ul className="list home-lines inbox-lines" aria-label="From the brief">
            {fromBrief.map((l) => (
              <li className="home-line" key={`${l.kind}:${l.title}`}>
                <span className="home-line-text">
                  {l.conversation
                    ? <button type="button" className="home-line-title" title="Open its conversation" onClick={() => go(l.conversation!)}>{l.title}</button>
                    : <span className="home-line-title">{l.title}</span>}
                  <span className="meta">{l.says}</span>
                </span>
                {l.url && <a className="home-line-out" href={l.url} target="_blank" rel="noopener noreferrer" title="Open the pull request" aria-label={`Open ${l.title} in a new tab`}><Icon name="link" /></a>}
                {step(l, l.title)}
              </li>
            ))}
          </ul>
        </section>
      )}

      {S.inbox.length > 0 && (
        <section aria-label="Reports">
          <h3 className="inbox-head">Reports</h3>
          <p className="set-note">What scheduled jobs and the {leadName()} wrote for you, newest first. Runs that find nothing new stay quiet.</p>
          <Reports S={S} refresh={refresh} />
        </section>
      )}
    </div>
  );
}
