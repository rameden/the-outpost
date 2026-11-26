// A setting you slide, in Orbit's panels: the sun's brightness, and (in a lens plugin, such as HD) a world's settings.

export type Limit = readonly [number, number];
const clamp = (x: number, [lo, hi]: Limit) => Math.min(hi, Math.max(lo, x));

// A setting you slide. flip: the bar reads the other way from the number (more cloud is a lower number, to the drawing).
export function Slide({ label, value, limit, onChange, flip, says }: { label: string; value: number; limit: Limit; onChange: (v: number) => void; flip?: boolean; says?: string }) {
  const [lo, hi] = limit, shown = flip ? lo + hi - value : value;
  return (
    <label className="orb-set">
      <span>{label}</span>
      <input type="range" min={lo} max={hi} step={(hi - lo) / 100} value={shown} aria-label={label}
        onChange={(ev) => { const v = Number(ev.target.value); onChange(clamp(flip ? lo + hi - v : v, limit)); }} />
      {says && <small>{says}</small>}
    </label>
  );
}
