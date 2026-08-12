/** The handful of marks the page needs. Vendor paths, no icon library. */

type Props = { className?: string };

export function GitHubGlyph({ className }: Props) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden className={className}>
      <path d="M12 .3a12 12 0 0 0-3.8 23.4c.6.1.8-.3.8-.6v-2c-3.3.7-4-1.6-4-1.6-.6-1.4-1.4-1.8-1.4-1.8-1.1-.7.1-.7.1-.7 1.2.1 1.9 1.2 1.9 1.2 1.1 1.9 2.8 1.3 3.5 1 .1-.8.4-1.3.8-1.6-2.7-.3-5.5-1.3-5.5-5.9 0-1.3.5-2.4 1.2-3.2-.1-.3-.5-1.5.1-3.2 0 0 1-.3 3.3 1.2a11.5 11.5 0 0 1 6 0c2.3-1.5 3.3-1.2 3.3-1.2.6 1.7.2 2.9.1 3.2.8.8 1.2 1.9 1.2 3.2 0 4.6-2.8 5.6-5.5 5.9.4.4.8 1.1.8 2.2v3.3c0 .3.2.7.8.6A12 12 0 0 0 12 .3Z" />
    </svg>
  );
}

export function AppleGlyph({ className }: Props) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden className={className}>
      <path d="M17.05 12.54c-.03-2.6 2.12-3.85 2.22-3.91-1.21-1.77-3.1-2.01-3.77-2.04-1.6-.16-3.13.94-3.94.94-.82 0-2.07-.92-3.4-.9-1.75.03-3.36 1.02-4.26 2.58-1.82 3.16-.47 7.83 1.3 10.39.87 1.25 1.9 2.66 3.25 2.61 1.31-.05 1.8-.85 3.38-.85 1.58 0 2.02.85 3.4.82 1.4-.02 2.29-1.28 3.15-2.54.99-1.46 1.4-2.87 1.42-2.94-.03-.01-2.72-1.05-2.75-4.16ZM14.5 4.66c.72-.87 1.2-2.08 1.07-3.29-1.03.04-2.28.69-3.02 1.56-.66.77-1.24 2-1.09 3.18 1.15.09 2.32-.58 3.04-1.45Z" />
    </svg>
  );
}

export function WindowsGlyph({ className }: Props) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden className={className}>
      <path d="M0 3.45 9.75 2.1v9.4H0V3.45Zm10.95-1.5L24 0v11.4H10.95V1.95ZM0 12.6h9.75V22L0 20.65V12.6Zm10.95 0H24V24l-13.05-1.8V12.6Z" />
    </svg>
  );
}

export function LinuxGlyph({ className }: Props) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden className={className}>
      <path d="M12 0C8.9 0 8.1 2.5 8.2 5c.1 2-.3 2.7-1 3.8-.8 1.3-2 2.9-2.6 5C4 15.5 4.3 17 5 17.7c-.2.6-.2 1.2.1 1.7.5.9 1.7 1.2 3 1.5 1.2.2 1.9.6 2.5 1 .6.4 1.3.6 2 .5.7 0 1.3-.4 1.7-.9.5-.6 1.4-1 2.5-1.4 1.1-.4 2-.9 2.2-1.8.1-.5 0-1-.3-1.5.6-.8.6-2.2.1-3.5-.6-1.8-1.8-3.2-2.6-4.4-.8-1.2-1.1-2-1-3.9C15.4 2.4 14.7 0 12 0Zm-1.6 5.1c.4 0 .7.5.7 1.1 0 .6-.3 1.1-.7 1.1-.4 0-.7-.5-.7-1.1 0-.6.3-1.1.7-1.1Zm3.3 0c.4 0 .7.5.7 1.1 0 .6-.3 1.1-.7 1.1-.4 0-.7-.5-.7-1.1 0-.6.3-1.1.7-1.1Zm-1.6 3c1 0 2 .6 2 1 0 .3-.3.5-.8.8-.5.3-.8.6-1.2.6-.4 0-.8-.3-1.3-.6-.5-.3-.8-.5-.8-.8 0-.4 1-1 2.1-1Z" />
    </svg>
  );
}

export function ArrowGlyph({ className }: Props) {
  return (
    <svg viewBox="0 0 16 16" fill="none" aria-hidden className={className}>
      <path
        d="M3.5 8h9m0 0L9 4.5M12.5 8 9 11.5"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function DownloadGlyph({ className }: Props) {
  return (
    <svg viewBox="0 0 16 16" fill="none" aria-hidden className={className}>
      <path
        d="M8 2.5v8m0 0L4.75 7.25M8 10.5l3.25-3.25M2.75 13.25h10.5"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
