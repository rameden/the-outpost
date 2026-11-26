// The tabs along the top of a page of its own (Memory, Activity): a tab list you can move along
// with the arrow keys, one tab in the tab order at a time. The page shows the panel.

import { useRef, type KeyboardEvent } from "react";

export type PageTab<T extends string> = { id: T; label: string; count?: number; title?: string };

export function PageTabs<T extends string>({ label, tabs, value, onChange }: { label: string; tabs: PageTab<T>[]; value: T; onChange: (id: T) => void }) {
  const list = useRef<HTMLDivElement>(null);
  const move = (ev: KeyboardEvent) => {
    const at = tabs.findIndex((t) => t.id === value);
    const to = ev.key === "ArrowRight" ? (at + 1) % tabs.length : ev.key === "ArrowLeft" ? (at - 1 + tabs.length) % tabs.length : ev.key === "Home" ? 0 : ev.key === "End" ? tabs.length - 1 : -1;
    if (to < 0) return;
    ev.preventDefault();
    onChange(tabs[to].id);
    list.current?.querySelectorAll<HTMLButtonElement>('[role="tab"]')[to]?.focus();
  };
  return (
    <div className="tabs page-tabs" role="tablist" aria-label={label} ref={list} onKeyDown={move}>
      {tabs.map((t) => (
        <button key={t.id} type="button" className="tab" role="tab" id={`tab-${label}-${t.id}`} aria-selected={value === t.id} tabIndex={value === t.id ? 0 : -1} title={t.title} onClick={() => onChange(t.id)}>
          {t.label}{!!t.count && <span className="count needs">{t.count}</span>}
        </button>
      ))}
    </div>
  );
}
