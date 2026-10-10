/**
 * The product mark: a rounded square holding a command prompt (code-1 from SVG Repo). Stroke-only,
 * so it takes its colour from the text colour around it; sized by its caller.
 */
export const LogoMark = ({ size = 28 }: { size?: number }) => (
  <svg
    aria-hidden="true"
    focusable="false"
    viewBox="0 0 24 24"
    width={size}
    height={size}
    fill="none"
    stroke="currentColor"
    strokeWidth="1.5"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M6.89 9a5.5 5.5 0 0 1 2.43 2.15c.35.52.35 1.19 0 1.71A5.5 5.5 0 0 1 6.89 15" />
    <path d="M13 15h4" />
    <path d="M9 22h6c5 0 7-2 7-7V9c0-5-2-7-7-7H9C4 2 2 4 2 9v6c0 5 2 7 7 7Z" />
  </svg>
);
