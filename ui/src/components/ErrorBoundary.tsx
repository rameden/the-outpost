// What's shown when part of the page throws while drawing itself. Without these, one bad card (a
// reply the page can't lay out, say) takes the whole page with it, and since the camp replays its
// feed on every load, reloading only hits it again.
//
// Three sizes: the whole page (main.tsx), one zone or drawer (App.tsx), one item in the feed.
// Each keeps the damage to itself: a broken panel leaves the message box working.

import { Component, type ErrorInfo, type ReactNode } from "react";
import { storeGet, storeRemove } from "../api.ts";

type Props = {
  children: ReactNode;
  // What to show instead. `retry` draws the children again (they may well throw again).
  fallback: (error: Error, retry: () => void) => ReactNode;
  // When this changes, what's inside is given another go (you moved to another conversation, say).
  resetKey?: unknown;
};

export class ErrorBoundary extends Component<Props, { error: Error | null; key: unknown }> {
  state = { error: null as Error | null, key: this.props.resetKey };
  static getDerivedStateFromError(e: unknown) { return { error: e instanceof Error ? e : new Error(String(e)) }; }
  static getDerivedStateFromProps(props: Props, state: { error: Error | null; key: unknown }) {
    return Object.is(props.resetKey, state.key) ? null : { error: null, key: props.resetKey };
  }
  componentDidCatch(error: Error, info: ErrorInfo) { console.error(error, info.componentStack); }
  retry = () => this.setState({ error: null });
  render() { return this.state.error ? this.props.fallback(this.state.error, this.retry) : this.props.children; }
}

// A zone of the page (the conversation, history, files, the terminal…): says which part broke and
// why, in that zone's own space, with a way to try it again.
export function ZoneBoundary({ name, resetKey, children }: { name: string; resetKey?: unknown; children: ReactNode }) {
  return (
    <ErrorBoundary resetKey={resetKey} fallback={(error, retry) => (
      <div className="zone-empty zone-broken" role="alert">
        <b>{name} couldn't be shown</b>
        <span>{error.message || "Something went wrong while drawing it."}</span>
        <button type="button" className="linkish" onClick={retry}>Try again</button>
      </div>
    )}>{children}</ErrorBoundary>
  );
}

// Something that opens over the page (an agent's page, Settings, a dialog): a small dialog in its
// place, so there's still something to close.
export function OverlayBoundary({ name, onClose, children }: { name: string; onClose: () => void; children: ReactNode }) {
  return (
    <ErrorBoundary fallback={(error) => (
      <>
        <div className="drawer-backdrop" onClick={onClose} />
        <div className="dialog confirm" role="alertdialog" aria-modal="true" aria-label={`${name} couldn't be shown`}>
          <h2>{name} couldn't be shown</h2>
          <div className="confirm-body"><p>{error.message || "Something went wrong while drawing it."}</p></div>
          <div className="dialog-actions"><button type="button" className="btn primary" autoFocus onClick={onClose}>Close</button></div>
        </div>
      </>
    )}>{children}</ErrorBoundary>
  );
}

// One item in the feed: a line where it would have been, and the rest of the conversation as it was.
export function ItemBoundary({ children }: { children: ReactNode }) {
  return <ErrorBoundary fallback={(error) => <div className="notice" title={error.message}>This item couldn't be shown.</div>}>{children}</ErrorBoundary>;
}

// What this browser remembers about where you were and how the page is arranged. If one of those
// is what breaks the page (a conversation with a card that can't be drawn), a plain reload opens
// straight back onto it; clearing them opens on a new conversation in the default layout.
const SAVED_PLACE = ["camp-view", "camp-layout"];

// The whole page: the last resort. Reload, or reload without the saved place.
export function PageBoundary({ children }: { children: ReactNode }) {
  return (
    <ErrorBoundary fallback={(error) => (
      <div className="page-broken" role="alert">
        <h1>The page hit a problem</h1>
        <p>{error.message || "Something went wrong while drawing it."}</p>
        <p className="meta">The camp itself is unaffected: anything that was running still is.</p>
        <div className="dialog-actions">
          {SAVED_PLACE.some((k) => storeGet(k) !== null) && (
            <button type="button" className="btn" title="Forget which conversation was open and how the page was arranged (in this browser), then reload. Use this if a plain reload ends up here again."
              onClick={() => { SAVED_PLACE.forEach(storeRemove); location.reload(); }}>Reload on a new conversation, default layout</button>
          )}
          <button type="button" className="btn primary" onClick={() => location.reload()}>Reload</button>
        </div>
      </div>
    )}>{children}</ErrorBoundary>
  );
}
