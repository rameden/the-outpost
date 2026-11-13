// Small pieces used across the panels.

import { useState, type ReactNode } from "react";

// One set of line icons, so the chrome doesn't mix emoji and odd glyphs. Decorative: the
// button around it carries the label.
const ICONS = {
  plus: "M12 5v14M5 12h14",
  folder: "M3 7.5h6.5l2 2H21v9.5H3z",
  search: "M11 4.5a6.500 6.500 0 100 13 6.500 6.500 0 000-13zM16 16l4.500 4.500",
  list: "M4 7h16M4 12h16M4 17h10",
  bell: "M6 16.500V11a6 6 0 0112 0v5.500l1.500 1.500h-15zM10 21h4",
  bellOff: "M6 16.500V11a6 6 0 019.500-4.900M18 11v5.500l1.500 1.500H8M10 21h4M4 4l16 16",
  terminal: "M5 8l4 4-4 4M12 16h7",
  lock: "M7.500 11V8a4.500 4.500 0 019 0v3M5.500 11h13v9h-13z",
  unlock: "M7.500 11V8a4.500 4.500 0 018.600-1.800M5.500 11h13v9h-13z",
  theme: "M12 3.500a8.500 8.500 0 100 17 8.500 8.500 0 000-17zM12 3.500v17M12 7.500a4.500 4.500 0 010 9",
  gear: "M4 7h9M17 7h3M4 17h3M11 17h9M15 4.500v5M9 14.500v5", // sliders: a cog at this size reads as a sun, next to the theme switch
  up: "M7 11v9H4v-9zM7 11l4-7c1.700 0 2.500 1.200 2.200 2.800L12.600 10H18c1.300 0 2.200 1.200 1.900 2.500l-1.400 6c-.200.900-1 1.500-1.900 1.500H7",
  down: "M7 13V4H4v9zM7 13l4 7c1.700 0 2.500-1.200 2.200-2.800L12.600 14H18c1.300 0 2.200-1.200 1.900-2.500l-1.400-6C18.300 4.600 17.500 4 16.600 4H7",
  branch: "M7 4.500v15M7 8a2 2 0 100-4 2 2 0 000 4zM7 20a2 2 0 100-4 2 2 0 000 4zM17 9a2 2 0 100-4 2 2 0 000 4zM17 9c0 4-4 4.500-10 6",
  x: "M6 6l12 12M18 6L6 18",
  check: "M5 12.500l4.500 4.500L19 7.500",
  chevron: "M7 10l5 5 5-5",
  chevronRight: "M10 7l5 5-5 5",
  chevronLeft: "M14 7l-5 5 5 5",
  chevronUp: "M7 14l5-5 5 5",
  users: "M9 11a3.500 3.500 0 100-7 3.500 3.500 0 000 7zM2.500 20c.500-3.500 3-5.500 6.500-5.500s6 2 6.500 5.500M16 4.500a3.500 3.500 0 010 6.500M18.500 14.800c1.800.800 2.800 2.600 3 5.200",
  shield: "M12 3l7.500 2.800v5.700c0 4.500-3 8-7.500 9.500-4.500-1.500-7.500-5-7.500-9.500V5.800zM9 12l2.200 2.200L15.200 10",
  gauge: "M4 17a8 8 0 1116 0M12 17l4-5",
  phone: "M8 3h8a1 1 0 011 1v16a1 1 0 01-1 1H8a1 1 0 01-1-1V4a1 1 0 011-1zM11 18h2",
  chart: "M4 20V4M4 20h16M8 16v-5M12 16V8M16 16v-3",
  clock: "M12 3.500a8.500 8.500 0 100 17 8.500 8.500 0 000-17zM12 7.500V12l3 2",
  inbox: "M3.500 13l2.500-8h12l2.500 8v6h-17zM3.500 13h5l1 2.500h5l1-2.500h5",
  bookmark: "M7 3.500h10v17l-5-3.500-5 3.500z",
  book: "M4 5c2.500-1 5.500-1 8 .500 2.500-1.500 5.500-1.500 8-.500v14c-2.500-1-5.500-1-8 .500-2.500-1.500-5.500-1.500-8-.500zM12 5.500v14",
  spark: "M12 3.500l2 6 6 2.500-6 2.500-2 6-2-6-6-2.500 6-2.500z",
  plug: "M9 3v5M15 3v5M6.500 8h11v3.500a5.500 5.500 0 01-11 0zM12 17v4",
  pin: "M9 3.500h6l-1 6 3 3.500H7l3-3.500zM12 13v7.500",
  link: "M10 14a4 4 0 005.700 0l3-3a4 4 0 00-5.700-5.700l-1 1M14 10a4 4 0 00-5.700 0l-3 3a4 4 0 005.700 5.700l1-1",
  file: "M7 3.500h7l4 4v13H7zM14 3.500v4h4",
  image: "M4 5h16v14H4zM4 16l4.500-4.500 3.500 3.500 3-3 5 5M9 9.500a1 1 0 100-2 1 1 0 000 2z",
  reply: "M9 7l-5 5 5 5M4 12h10a6 6 0 016 6v1",
  panelRight: "M4 5h16v14H4zM14.500 5v14",
  layout: "M4 5h16v14H4zM4 10h16M10 10v9",
  focus: "M4 9V5h4M20 9V5h-4M4 15v4h4M20 15v4h-4M9.500 9.500h5v5h-5z",
  refresh: "M19.500 12a7.500 7.500 0 11-2.200-5.300M19.500 4v3.500H16",
  diff: "M12 4v8M8 8h8M8 18h8", // a plus over a minus: what changed
  filter: "M4 7h16M7 12h10M10 17h4",
  plane: "M12 3.500v16M3.500 14l8.500-4.500 8.500 4.500M8.500 20.500l3.500-2 3.500 2", // seen from above, nose up
  at: "M15.500 12a3.500 3.500 0 11-7 0 3.500 3.500 0 017 0zM15.500 8.500V13c0 1.400 1 2.500 2.300 2.500S20 14.400 20 12.500V12a8 8 0 10-3.200 6.400",
} as const;
export type IconName = keyof typeof ICONS;
export function Icon({ name }: { name: IconName }) {
  return (
    <svg className="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={ICONS[name]} />
    </svg>
  );
}

// "Nothing here yet", with a title and a line of explanation.
export function Empty({ title, children }: { title: string; children: ReactNode }) {
  return <div className="empty"><b>{title}</b>{children}</div>;
}

// Two lines of text that open up when clicked.
export function Clamp({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  return <div className={open ? "clamp open" : "clamp"} onClick={() => setOpen((v) => !v)}>{children}</div>;
}

// The top of a drawer (History, Files, the terminal): the same icon and name as the rail that
// opens it, and clicking the name, or any empty part of the header, closes it again. Controls in
// the header (tabs, buttons) keep their own clicks.
export function DrawerHead({ icon, label, hideLabel, hideTitle, onHide, className, children }: {
  icon: IconName; label: string; hideLabel: string; hideTitle: string; onHide?: () => void; className?: string; children?: ReactNode;
}) {
  const name = <><Icon name={icon} /><span>{label}</span></>;
  return (
    <header className={["pane-head", onHide && "closable", className].filter(Boolean).join(" ")}
      onClick={onHide && ((e) => { if (!(e.target as Element).closest("button, a, input, select, textarea, [role=tab]")) onHide(); })}>
      {onHide
        ? <button type="button" className="pane-label" aria-label={hideLabel} aria-expanded="true" title={hideTitle} onClick={onHide}>{name}</button>
        : <span className="pane-label">{name}</span>}
      {children}
    </header>
  );
}

// An open side drawer (History, Files): the rail that opened it stays on its outer edge, and
// clicking the rail (anywhere but its own buttons) closes the drawer again. tools: small buttons
// that sit on the rail, under the name. In a zone along the top or bottom the rail lies flat
// across the top instead (styles.css).
export function Drawer({ icon, label, hideLabel, hideTitle, onHide, tools, children }: {
  icon: IconName; label: string; hideLabel: string; hideTitle: string; onHide: () => void; tools?: ReactNode; children: ReactNode;
}) {
  return (
    <div className="side-drawer">
      <div className="zone-rail open" onClick={(e) => { if (!(e.target as Element).closest("button, a, input")) onHide(); }}>
        <button type="button" className="rail-main" aria-label={hideLabel} aria-expanded="true" title={hideTitle} onClick={onHide}>
          <Icon name={icon} /><span>{label}</span>
        </button>
        {tools && <div className="rail-tools">{tools}</div>}
      </div>
      {children}
    </div>
  );
}
