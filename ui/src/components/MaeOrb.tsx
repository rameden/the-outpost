// The Mae orb: the logo. A lit core inside two turning dials, with rings rippling outward.
// It's drawn in CSS (.mae-orb in styles.css), so it needs no inline styles: its size is the
// stylesheet's (--orb), and `state` only says how lively it is. "idle" is the calm one; the
// others turn faster and glow brighter, for when the camp is at work.
//
// With a `label` it's an image by that name; without one it's decoration beside the written name.

export type MaeOrbState = "idle" | "listening" | "thinking" | "speaking";

export function MaeOrb({ className, state = "idle", label }: { className?: string; state?: MaeOrbState; label?: string }) {
  return (
    <span className={className ? `mae-orb ${className}` : "mae-orb"} data-state={state} {...(label ? { role: "img", "aria-label": label } : { "aria-hidden": true })}>
      <span className="orb-glow" />
      <span className="orb-ripple" />
      <span className="orb-ripple late" />
      <span className="orb-ripple busy" />
      <span className="orb-dial"><i /><i /><i /></span>
      <span className="orb-dial inner" />
      <span className="orb-core"><i /></span>
      <span className="orb-light" />
    </span>
  );
}
