/** The handful of line icons the fragments need, drawn at the app's stroke
 *  weight. Sized in em so they follow the fragment's type. */

type Props = { className?: string; style?: React.CSSProperties };

const base = { fill: "none", stroke: "currentColor", strokeWidth: 1.7, strokeLinecap: "round", strokeLinejoin: "round" } as const;

export function Check({ className, style }: Props) {
  return (
    <svg viewBox="0 0 16 16" className={className} style={{ width: "1em", height: "1em", ...style }} {...base}>
      <circle cx="8" cy="8" r="6.2" />
      <path d="m5.4 8.2 1.8 1.8 3.5-3.7" />
    </svg>
  );
}

export function Cross({ className, style }: Props) {
  return (
    <svg viewBox="0 0 16 16" className={className} style={{ width: "1em", height: "1em", ...style }} {...base}>
      <circle cx="8" cy="8" r="6.2" />
      <path d="m6 6 4 4m0-4-4 4" />
    </svg>
  );
}

export function Warn({ className, style }: Props) {
  return (
    <svg viewBox="0 0 16 16" className={className} style={{ width: "1em", height: "1em", ...style }} {...base}>
      <path d="M8 2.6 14 13H2L8 2.6Z" />
      <path d="M8 6.6v3M8 11.3v.1" />
    </svg>
  );
}

export function Spin({ className, style }: Props) {
  return (
    <svg viewBox="0 0 16 16" className={className} style={{ width: "1em", height: "1em", ...style }} {...base}>
      <circle cx="8" cy="8" r="6" opacity="0.25" />
      <path d="M8 2a6 6 0 0 1 6 6" />
    </svg>
  );
}

export function Chevron({ className, style, down }: Props & { down?: boolean }) {
  return (
    <svg viewBox="0 0 16 16" className={className} style={{ width: "0.9em", height: "0.9em", ...style }} {...base}>
      <path d={down ? "m4 6 4 4 4-4" : "m6 4 4 4-4 4"} />
    </svg>
  );
}

export function Play({ className, style }: Props) {
  return (
    <svg viewBox="0 0 16 16" className={className} style={{ width: "1em", height: "1em", ...style }} {...base}>
      <path d="M5 3.5v9l7-4.5-7-4.5Z" />
    </svg>
  );
}

export function Send({ className, style }: Props) {
  return (
    <svg viewBox="0 0 16 16" className={className} style={{ width: "1em", height: "1em", ...style }} {...base}>
      <path d="M14 2 7 9M14 2l-4.5 12L7 9 2 6.5 14 2Z" />
    </svg>
  );
}

export function Clock({ className, style }: Props) {
  return (
    <svg viewBox="0 0 16 16" className={className} style={{ width: "1em", height: "1em", ...style }} {...base}>
      <circle cx="8" cy="8" r="6.2" />
      <path d="M8 4.8V8l2.2 1.4" />
    </svg>
  );
}

export function Key({ className, style }: Props) {
  return (
    <svg viewBox="0 0 16 16" className={className} style={{ width: "1em", height: "1em", ...style }} {...base}>
      <circle cx="5.5" cy="10.5" r="3" />
      <path d="m7.7 8.3 5.8-5.8M11.5 4.5 13 6" />
    </svg>
  );
}

export function Server({ className, style }: Props) {
  return (
    <svg viewBox="0 0 16 16" className={className} style={{ width: "1em", height: "1em", ...style }} {...base}>
      <rect x="2.5" y="2.5" width="11" height="4.5" rx="1.2" />
      <rect x="2.5" y="9" width="11" height="4.5" rx="1.2" />
      <path d="M5 4.75h.01M5 11.25h.01" />
    </svg>
  );
}

export function Eye({ className, style }: Props) {
  return (
    <svg viewBox="0 0 16 16" className={className} style={{ width: "1em", height: "1em", ...style }} {...base}>
      <path d="M1.8 8S4 3.8 8 3.8 14.2 8 14.2 8 12 12.2 8 12.2 1.8 8 1.8 8Z" />
      <circle cx="8" cy="8" r="1.8" />
      <path d="m2.5 13.5 11-11" />
    </svg>
  );
}

export function Bookmark({ className, style }: Props) {
  return (
    <svg viewBox="0 0 16 16" className={className} style={{ width: "1em", height: "1em", ...style }} {...base}>
      <path d="M4.5 2.5h7v11L8 11l-3.5 2.5v-11Z" />
    </svg>
  );
}

export function Search({ className, style }: Props) {
  return (
    <svg viewBox="0 0 16 16" className={className} style={{ width: "1em", height: "1em", ...style }} {...base}>
      <circle cx="7" cy="7" r="4.3" />
      <path d="m10.3 10.3 3.2 3.2" />
    </svg>
  );
}

/** Codeforces' three bars, in their own colours, as the app draws them. */
export function CodeforcesMark({ style }: Props) {
  return (
    <svg viewBox="0 0 16 16" style={{ width: "1em", height: "1em", ...style }}>
      <rect x="1" y="6" width="3.6" height="8.5" rx="0.9" fill="#F5C518" />
      <rect x="6.2" y="2" width="3.6" height="12.5" rx="0.9" fill="#1F8ACB" />
      <rect x="11.4" y="8" width="3.6" height="6.5" rx="0.9" fill="#E04848" />
    </svg>
  );
}
