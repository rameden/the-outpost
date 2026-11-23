// The logo: the logo kit's mark and the name, as its lockup sets them (docs/brand). The mark is the
// kit's small one, made for sizes like the header's, where the full mark's lines would be thinner
// than a pixel. The ink is the colour of the text around it and the centre is the kit's amber;
// the stylesheet sets both for each theme (--wordmark and --logo-dot in styles.css).

// Another outpost's logo is the same mark with its own name beside it, set in type (outpost.ts).

import { LETTERS } from "./MaeWord.tsx";
import { isMae, outpostName } from "../outpost.ts";

export function MaeLogo({ className, name = outpostName() }: { className?: string; name?: string }) {
  if (!isMae(name)) return (
    <span className={className ? `outpost-logo ${className}` : "outpost-logo"} role="img" aria-label={`Outpost ${name}`}>
      <MaeMark />
      <span className="outpost-name" aria-hidden="true">{name}</span>
    </span>
  );
  return (
    <svg className={className ? `mae-logo ${className}` : "mae-logo"} xmlns="http://www.w3.org/2000/svg" viewBox="10 10 532.5 180" role="img" aria-label="Outpost Mae">
      <path fill="currentColor" d="M100 10 A90 90 0 0 0 100 190 L100 157 A57 57 0 0 1 100 43 Z M100 53 A47 47 0 0 0 100 147 L100 130 A30 30 0 0 1 100 70 Z" />
      <g fill="none" stroke="currentColor" strokeWidth="8">
        <path d="M100 48 A52 52 0 0 1 100 152" />
        <path d="M100 14 A86 86 0 0 1 100 186" />
      </g>
      <circle className="logo-dot" cx="100" cy="100" r="20" />
      <path fill="currentColor" d={LETTERS} />
    </svg>
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
        <path d="M100 14 A86 86 0 0 1 100 186" />
      </g>
      <circle className="logo-dot" cx="100" cy="100" r="22" />
    </svg>
  );
}
