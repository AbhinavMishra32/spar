import { Component, useState, type ErrorInfo, type ReactNode } from "react";
import { Copy, RotateCcw } from "lucide-react";

/**
 * What the window shows when the app throws while rendering.
 *
 * React unmounts the whole tree when a render throws and nothing catches it, so
 * without this the window goes white and stays white — the one failure mode that
 * tells the learner nothing at all, not even that something broke rather than
 * hung. The reason is on screen because the alternative is asking somebody to
 * open a developer console to find out why their app disappeared.
 *
 * A class, because this is the only thing in React that a hook cannot do.
 */
export class CrashBoundary extends Component<{ children: ReactNode }, { error: Error | null; componentStack: string }> {
  override state = { error: null as Error | null, componentStack: "" };

  static getDerivedStateFromError(error: unknown) {
    return { error: error instanceof Error ? error : new Error(String(error)) };
  }

  override componentDidCatch(error: unknown, info: ErrorInfo) {
    /* Still logged. The screen is for the person in front of it; the console is
       what a stack trace gets pasted out of. */
    console.error("[spar] render crashed:", error, info.componentStack);
    this.setState({ componentStack: info.componentStack ?? "" });
  }

  override render() {
    if (!this.state.error) return this.props.children;
    return <CrashScreen componentStack={this.state.componentStack} error={this.state.error} />;
  }
}

function CrashScreen({ error, componentStack }: { error: Error; componentStack: string }) {
  const [copied, setCopied] = useState(false);
  const report = [error.stack || `${error.name}: ${error.message}`, componentStack && `Component stack:${componentStack}`]
    .filter(Boolean)
    .join("\n\n");

  const copy = () => {
    void navigator.clipboard.writeText(report).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    });
  };

  return (
    <div className="app-drag flex h-full w-full flex-col items-center justify-center gap-4 bg-background px-8 py-10 text-foreground">
      <div className="app-no-drag flex w-full max-w-[44rem] flex-col gap-3">
        <div>
          <h1 className="text-[1.05rem] font-semibold">Spar hit an error and stopped drawing.</h1>
          {/* The message, not a euphemism for it. "Something went wrong" is the
              one sentence that cannot be acted on by anybody, including us. */}
          <p className="mt-1 text-content text-muted-foreground">
            Your work is on disk — this is the window, not the session. Reloading usually brings it back.
          </p>
        </div>

        <p className="rounded-[var(--radius-md)] border border-[var(--border-strong)] bg-[var(--color-background-elevated-secondary)] px-3 py-2 font-mono text-ui break-words">
          {error.message || error.name}
        </p>

        {/* Scrolls rather than grows: a React component stack is forty frames
            deep and would push the two buttons off the bottom of the window. */}
        <pre className="app-scroll max-h-[15rem] overflow-auto rounded-[var(--radius-md)] border border-border bg-[var(--color-background-elevated-secondary)] px-3 py-2 font-mono text-ui-sm leading-[1.55] whitespace-pre-wrap text-muted-foreground">
          {report}
        </pre>

        <div className="flex items-center gap-2">
          <button
            className="inline-flex h-7 items-center gap-1.5 rounded-md bg-primary px-2.5 text-ui font-medium text-primary-foreground transition-opacity hover:opacity-90"
            onClick={() => location.reload()}
            type="button"
          >
            <RotateCcw className="size-3.5" />
            Reload Spar
          </button>
          <button
            className="inline-flex h-7 items-center gap-1.5 rounded-md border border-[var(--border-strong)] px-2.5 text-ui font-medium transition-colors hover:bg-accent"
            onClick={copy}
            type="button"
          >
            <Copy className="size-3.5" />
            {copied ? "Copied" : "Copy report"}
          </button>
        </div>
      </div>
    </div>
  );
}
