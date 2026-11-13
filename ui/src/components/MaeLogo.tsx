// The logo: the logo kit's mark and the name, as its lockup sets them (docs/brand). The mark is the
// kit's small one, made for sizes like the header's, where the full mark's lines would be thinner
// than a pixel. The ink is the colour of the text around it and the centre is the kit's amber;
// the stylesheet sets both for each theme (--wordmark and --logo-dot in styles.css).

import { LETTERS } from "./MaeWord.tsx";

export function MaeLogo({ className }: { className?: string }) {
  return (
    <svg className={className ? `mae-logo ${className}` : "mae-logo"} xmlns="http://www.w3.org/2000/svg" viewBox="10 10 532.5 180" role="img" aria-label="Mae">
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
