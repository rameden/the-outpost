// Small pieces used across the panels.

import { useState, type ReactNode } from "react";

// "Nothing here yet", with a title and a line of explanation.
export function Empty({ title, children }: { title: string; children: ReactNode }) {
  return <div className="empty"><b>{title}</b>{children}</div>;
}

// Two lines of text that open up when clicked.
export function Clamp({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  return <div className={open ? "clamp open" : "clamp"} onClick={() => setOpen((v) => !v)}>{children}</div>;
}
