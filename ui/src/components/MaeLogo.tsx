// The logo: the logo kit's mark, then "Outpost" with this outpost's name under it ("Mae", or what
// it's been renamed to in Settings, General). The mark is the kit's small one, made for sizes like
// the header's, where the full mark's lines would be thinner than a pixel. Its ink is the colour of
// the text around it and its centre is the kit's amber (--wordmark and --logo-dot in styles.css).
// The smaller amber dot sitting in a gap in the outer ring is an outpost.

import { outpostName } from "../outpost.ts";

export function MaeLogo({ className, name = outpostName() }: { className?: string; name?: string }) {
  return (
    <span className={className ? `outpost-logo ${className}` : "outpost-logo"} role="img" aria-label={`Outpost ${name}`}>
      <MaeMark />
      <span className="outpost-words" aria-hidden="true">
        <span className="outpost-title">Outpost</span>
        <span className="outpost-sub">{name}</span>
      </span>
    </span>
  );
}

// The mark alone, at the size of a word: what marks a Mae ticket beside Jira's (TicketsPage.tsx).
export function MaeMark({ className, title }: { className?: string; title?: string }) {
  return (
    <svg className={className ? `mae-mark ${className}` : "mae-mark"} xmlns="http://www.w3.org/2000/svg" viewBox="10 10 180 180" role={title ? "img" : undefined} aria-label={title} aria-hidden={title ? undefined : true}>
      {title && <title>{title}</title>}
      <path fill="currentColor" d="M100 10 A90 90 0 0 0 100 190 L100 157 A57 57 0 0 1 100 43 Z M100 53 A47 47 0 0 0 100 147 L100 130 A30 30 0 0 1 100 70 Z" />
      <g fill="none" stroke="currentColor" strokeWidth="12">
        <path d="M100 48 A52 52 0 0 1 100 152" />
        <path d="M100 14 A86 86 0 0 1 146.21 27.47 M172.53 53.79 A86 86 0 0 1 100 186" />
      </g>
      <circle className="logo-dot" cx="100" cy="100" r="22" />
      <circle className="logo-dot" cx="160.81" cy="39.19" r="13" />
    </svg>
  );
}
