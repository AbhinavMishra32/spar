import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Editor, { type OnMount } from "@monaco-editor/react";
import { Panel, PanelGroup, type ImperativePanelHandle } from "react-resizable-panels";
import {
  AlertCircle,
  ChevronDown,
  Code2,
  Download,
  Eye,
  Layers,
  Library,
  Loader2,
  Maximize2,
  Minimize2,
  Minus,
  Play,
  Plus,
  RotateCcw,
  Sparkles,
  SquareTerminal,
  TriangleAlert,
  X,
} from "lucide-react";
import type { Language } from "@spar/domain";
import { dialect } from "@spar/visualizer";
import { cn } from "@/lib/utils";
import { canvasSubject, traceVerdict } from "@/lib/visualizer";
import { EDITOR_OPTIONS, EDITOR_THEME_DARK, EDITOR_THEME_LIGHT, editorFontOptions, intellisenseOptions } from "@/lib/monaco-theme";
import { useCodeFont } from "@/lib/code-font";
import { useIntellisense } from "@/hooks/use-intellisense";
import type { SparApi } from "../../../shared/api";
import { useVisualizer } from "../../hooks/use-visualizer";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Segmented } from "@/components/ui/segmented";
import { InputForm } from "../visualizer/InputForm";
import { Inspector } from "../visualizer/Inspector";
import { ProblemBanner, ProblemPicker } from "../visualizer/ProblemPicker";
import { StructureCanvas } from "../visualizer/StructureCanvas";
import { StepNarration, Transport } from "../visualizer/Transport";
import { PaneHandle } from "../workspace/PaneHandle";

/**
 * The visualiser.
 *
 * Three regions, and the split is the argument the page is making. On the left
 * is what you *wrote*; on the right is what it *did*; underneath that is what it
 * *held*. A learner reading left to right is reading cause to effect, and the
 * timeline under the right region is the only control that moves them through
 * it — so there is exactly one notion of "where am I" on the page.
 *
 * Every one of those splits is draggable and remembered, because which of the
 * three matters most is a property of the problem rather than of the page. A
 * forty-line solution wants the editor; a tree wants the canvas; a bug in a
 * dictionary wants the inspector. The proportions are the learner's to set.
 *
 * Inputs live under the code rather than in a second editor tab, which is the
 * substantive difference from a standalone visualiser. The form is derived from
 * the code above it and prefilled from the problem above that, so the common
 * path from opening a problem to watching it run involves typing nothing at all.
 *
 * The staleness rule is load-bearing and worth stating once: editing anything
 * leaves the last trace on screen — throwing away the picture someone is
 * studying because they fixed a typo would be hostile — but marks it stale,
 * disables the transport, and says so. The canvas must never be readable as
 * current when it is not.
 */
export function VisualizerPage({ api, dark, onError }: { api: SparApi | undefined; dark: boolean; onError(message: string | null): void }) {
  /* Python is the only language with an adapter today. The picker is written
     against the registry rather than against Python, so a second adapter shows
     up here without touching this page. */
  const [language] = useState<Language>("python");
  const state = useVisualizer(api, language);
  const spoken = dialect(language);

  const [picking, setPicking] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [memory, setMemory] = useState(false);
  const [zoom, setZoom] = useState(1);
  const [expanded, setExpanded] = useState(false);
  /* "Fill the window" is the editor pane's collapsed state, not a second width.
     Driving it through the panel's own handle keeps one source of truth:
     dragging the divider to the edge and pressing the button end in the same
     place, and the button's icon follows whichever of the two did it. */
  const editorPane = useRef<ImperativePanelHandle>(null);

  /* The editor is the other half of the canvas. A step that says "line 12" and
     leaves the learner to find line 12 has made them do the one piece of work
     the whole feature exists to remove — reading a picture and a program at the
     same time is only possible when both say where you are. */
  const editorApi = useRef<Parameters<OnMount>[0] | null>(null);
  const lineMark = useRef<ReturnType<Parameters<OnMount>[0]["createDecorationsCollection"]> | null>(null);
  const [editorReady, setEditorReady] = useState(false);
  const [intellisense] = useIntellisense();
  const [codeFont] = useCodeFont();

  const frame = state.trace?.frames[state.index];
  const previous = state.index > 0 ? state.trace?.frames[state.index - 1] : undefined;
  const note = frame ? state.trace?.notes[String(frame.line)] : undefined;
  const count = state.trace?.frames.length ?? 0;
  const verdict = useMemo(() => traceVerdict(state.trace), [state.trace]);

  /* Selecting an object is a claim about the current step, and it stops being
     true when the step changes — an @n7 that has been collected is a highlight
     on nothing. Cleared on every move rather than validated, because a
     selection that silently survives onto a different object is worse. */
  useEffect(() => setSelected(null), [state.index]);

  /**
   * Mark the line this step is on.
   *
   * The whole line, plus its number and a bar in the gutter: a background alone
   * is easy to lose in a file, and the number is where somebody looks when the
   * narration says "line 12".
   *
   * Drawn differently once the code has been edited. The trace is then a
   * statement about a file that no longer exists, and a confident highlight on
   * a line that has since moved is the most misleading thing the page could
   * show — so the mark goes quiet rather than disappearing, which would read as
   * "no line" instead of "not any more".
   */
  const currentLine = frame?.line;
  useEffect(() => {
    if (!editorReady) return;
    const marks = lineMark.current;
    if (!marks) return;
    if (!currentLine) {
      marks.clear();
      return;
    }
    marks.set([{
      range: { startLineNumber: currentLine, startColumn: 1, endLineNumber: currentLine, endColumn: 1 },
      options: {
        className: state.stale ? "viz-line viz-line-stale" : "viz-line",
        isWholeLine: true,
        lineNumberClassName: state.stale ? "viz-line-number viz-line-number-stale" : "viz-line-number",
        linesDecorationsClassName: state.stale ? "viz-line-gutter viz-line-gutter-stale" : "viz-line-gutter",
      },
    }]);
    // Only when it has gone off screen: scrolling a line that is already
    // visible back to the middle makes the file jump on every step.
    editorApi.current?.revealLineInCenterIfOutsideViewport(currentLine, 0);
  }, [currentLine, editorReady, state.stale]);

  const mountEditor = useCallback<OnMount>((instance) => {
    editorApi.current = instance;
    lineMark.current = instance.createDecorationsCollection();
    setEditorReady(true);
  }, []);

  useEffect(() => onError(state.error), [state.error, onError]);

  const run = state.run;
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
        event.preventDefault();
        void run();
        return;
      }
      // Everything below is a bare key, so it yields to anywhere text goes.
      if (target?.closest("input, textarea, select, [contenteditable], .monaco-editor, [role='dialog']")) return;
      if (event.key === "ArrowRight") { event.preventDefault(); state.step(1); }
      if (event.key === "ArrowLeft") { event.preventDefault(); state.step(-1); }
      if (event.code === "Space" && count > 0 && !state.stale) { event.preventDefault(); state.setPlaying(!state.playing); }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [count, run, state]);

  /** The learner's file plus the helpers the runtime injects, so an exported
   *  script runs outside Spar unchanged. */
  const exportScript = useCallback(() => {
    const body = `${spoken?.prelude ?? ""}${state.code}\n\n# Input\n${state.composed}\n`;
    const link = document.createElement("a");
    link.href = URL.createObjectURL(new Blob([body], { type: "text/x-python" }));
    link.download = spoken?.fileName ?? "algorithm.py";
    link.click();
    URL.revokeObjectURL(link.href);
  }, [spoken, state.code, state.composed]);

  if (!spoken) {
    return <div className="grid h-full place-items-center text-ui text-muted-foreground">No visualiser is installed for this language.</div>;
  }

  return (
    <>
      <PanelGroup autoSaveId="spar-visualizer" className="flex h-full min-h-0" direction="horizontal">
        {/* ---- Left: the code, and the inputs derived from it ---------------- */}
        <Panel
          className="flex min-h-0 flex-col overflow-hidden border-r border-border"
          collapsedSize={0}
          collapsible
          defaultSize={32}
          maxSize={60}
          minSize={18}
          onCollapse={() => setExpanded(true)}
          onExpand={() => setExpanded(false)}
          order={1}
          ref={editorPane}
        >
          <header className="flex h-10 shrink-0 items-center gap-2 border-b border-border px-3">
            <Code2 className="size-3.5 text-muted-foreground" />
            <span className="font-mono text-ui font-medium">{spoken.fileName}</span>
            {state.stale && <span className="size-1.5 rounded-full bg-warning" title="Edited since the last run" />}
            <div className="ml-auto flex items-center gap-0.5">
              <Button className="text-muted-foreground" onClick={() => setPicking(true)} size="xs" variant="ghost">
                <Library data-icon="inline-start" />
                Problem
              </Button>
              <Button className="text-muted-foreground" onClick={exportScript} size="icon-xs" title="Export a runnable script" variant="ghost">
                <Download />
              </Button>
              <Button
                className="text-muted-foreground"
                onClick={() => { state.setCode(spoken.starter); state.clearProblem(); }}
                size="icon-xs"
                title="Reset to the starting example"
                variant="ghost"
              >
                <RotateCcw />
              </Button>
            </div>
          </header>

          <PanelGroup autoSaveId="spar-visualizer-editor" className="min-h-0 flex-1" direction="vertical">
            <Panel className="min-h-0" defaultSize={48} minSize={12} order={1}>
              <Editor
                language={spoken.editorLanguage}
                onChange={(value) => state.setCode(value ?? "")}
                onMount={mountEditor}
                options={{ ...EDITOR_OPTIONS, ...intellisenseOptions(intellisense), ...editorFontOptions(codeFont), automaticLayout: true, padding: { top: 10, bottom: 10 }, renderLineHighlight: "none", tabSize: 4, wordWrap: "on" }}
                theme={dark ? EDITOR_THEME_DARK : EDITOR_THEME_LIGHT}
                value={state.code}
              />
            </Panel>

            <PaneHandle direction="vertical" />

            {/* ---- Inputs ---------------------------------------------------- */}
            <Panel className="app-scroll min-h-0 overflow-y-auto border-t border-border" defaultSize={52} minSize={15} order={2}>
                <div className="sticky top-0 z-10 flex items-center gap-2 border-b border-border bg-[var(--color-background-surface-under)] px-3 py-2">
                  <SquareTerminal className="size-3.5 text-muted-foreground" />
                  <span className="text-ui font-medium">Input</span>

                  {/* Which function to start from. Hidden when there is only one,
                      because a picker with one option is furniture. */}
                  {state.spec.entryPoints.length > 1 && (
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button className="max-w-52 text-muted-foreground" size="xs" variant="ghost">
                          <span className="truncate font-mono">{state.entry?.label ?? "choose"}</span>
                          <ChevronDown data-icon="inline-end" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="start">
                        {state.spec.entryPoints.map((item) => (
                          <DropdownMenuItem disabled={Boolean(item.unsupported)} key={item.id} onSelect={() => state.selectEntry(item.id)}>
                            <span className="font-mono">{item.label}</span>
                          </DropdownMenuItem>
                        ))}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  )}

                  <div className="ml-auto flex items-center gap-1.5">
                    {state.status === "analyzing" && <Loader2 className="size-3 animate-spin text-muted-foreground" />}
                    <Segmented
                      ariaLabel="How to give input"
                      className="w-36"
                      onChange={state.setMode}
                      options={[{ value: "form", label: "Form" }, { value: "raw", label: "Code" }]}
                      value={state.draft.mode}
                    />
                  </div>
                </div>

                <div className="flex flex-col gap-3 px-3 py-3">
                  {state.problem && (
                    <ProblemBanner
                      exampleCount={state.problem.examples.length}
                      onClear={state.clearProblem}
                      onExample={state.useExample}
                      onOpenExternal={(url) => void api?.openExternal(url)}
                      problem={state.problem}
                    />
                  )}

                  {/* Where the shapes came from. One line, because a learner who is
                      about to trust a generated form should know whether it came from
                      LeetCode's own types or from Spar reading their file. */}
                  {state.spec.origin !== "none" && state.draft.mode === "form" && (
                    <p className="flex items-center gap-1.5 text-ui-sm text-muted-foreground">
                      <Sparkles className="size-3" />
                      {state.spec.origin === "signature" ? "Built from the signature this problem declares." : "Built from your code."}
                    </p>
                  )}

                  {state.spec.warnings.map((warning) => (
                    <p className="flex items-start gap-1.5 text-ui-sm text-muted-foreground" key={warning}>
                      <TriangleAlert className="mt-px size-3 shrink-0 text-warning" />
                      <span>{warning}</span>
                    </p>
                  ))}

                  {state.draft.mode === "form" ? (
                    state.entry ? (
                      <InputForm
                        entry={state.entry}
                        onChange={state.setValue}
                        onRetype={state.retypeParam}
                        values={state.draft.values}
                      />
                    ) : (
                      <p className="rounded-xl border border-dashed border-border px-3.5 py-3 text-ui text-muted-foreground">
                        Spar found nothing to call in this file yet. Define a function, or switch to Code and write the call yourself.
                      </p>
                    )
                  ) : (
                    <Textarea
                      className="min-h-24 font-mono text-ui"
                      onChange={(event) => state.setRawSource(event.target.value)}
                      placeholder={`print(Solution().twoSum([2, 7, 11, 15], 9))`}
                      value={state.draft.source}
                    />
                  )}

                  {/* The composed call, always. The form is a faster way to write
                      this, not a way to avoid knowing what it is — and a learner who
                      reads it a few times stops needing the form. */}
                  {state.draft.mode === "form" && state.composed && (
                    <div className="rounded-lg border border-border bg-[var(--color-background-editor)] px-2.5 py-2">
                      <p className="text-ui-sm uppercase tracking-[0.08em] text-muted-foreground">Runs as</p>
                      <pre className="mt-1 whitespace-pre-wrap break-all font-mono text-ui">{state.composed}</pre>
                    </div>
                  )}
                </div>
            </Panel>
          </PanelGroup>

        <div className="flex shrink-0 items-center gap-2 border-t border-border px-3 py-2.5">
          <Button className="flex-1" disabled={state.status === "tracing"} onClick={() => void state.run()}>
            {state.status === "tracing" ? <Loader2 className="animate-spin" data-icon="inline-start" /> : <Play data-icon="inline-start" />}
            {state.status === "tracing" ? "Tracing…" : "Run"}
            <kbd className="ml-1 rounded bg-primary-foreground/15 px-1 text-ui-sm">⌘↵</kbd>
          </Button>
        </div>
      </Panel>

      <PaneHandle />

      {/* ---- Right: the picture, the narration, and the debugger ----------- */}
      <Panel className="flex min-h-0 min-w-0 flex-col" minSize={30} order={2}>
        <header className="flex h-10 shrink-0 items-center gap-2 border-b border-border px-3">
          <Segmented
            ariaLabel="What to draw"
            className="w-52"
            onChange={(value) => setMemory(value === "memory")}
            options={[
              { value: "structure", label: "Structure", icon: Eye },
              { value: "memory", label: "Memory", icon: Layers },
            ]}
            value={memory ? "memory" : "structure"}
          />
          <span className="ml-1 text-ui text-muted-foreground">{canvasSubject(frame)}</span>

          <div className="ml-auto flex items-center gap-1">
            <div className="flex items-center rounded-lg bg-[var(--color-background-elevated-secondary)] p-0.5">
              <Button className="text-muted-foreground" onClick={() => setZoom((value) => Math.max(0.5, value - 0.1))} size="icon-xs" title="Zoom out" variant="ghost">
                <Minus />
              </Button>
              <button className="px-1 text-ui-sm tabular-nums text-muted-foreground hover:text-foreground" onClick={() => setZoom(1)} type="button">
                {Math.round(zoom * 100)}%
              </button>
              <Button className="text-muted-foreground" onClick={() => setZoom((value) => Math.min(1.8, value + 0.1))} size="icon-xs" title="Zoom in" variant="ghost">
                <Plus />
              </Button>
            </div>
            <Button
              className="text-muted-foreground"
              onClick={() => (editorPane.current?.isCollapsed() ? editorPane.current.expand() : editorPane.current?.collapse())}
              size="icon-xs"
              title={expanded ? "Show the editor" : "Fill the window"}
              variant="ghost"
            >
              {expanded ? <Minimize2 /> : <Maximize2 />}
            </Button>
          </div>
        </header>

        <PanelGroup autoSaveId="spar-visualizer-canvas" className="min-h-0 flex-1" direction="vertical">
          {/* The picture and the controls that move through it stay one pane:
              the transport belongs to the canvas, not to the debugger. */}
          <Panel className="flex min-h-0 flex-col" defaultSize={68} minSize={25} order={1}>
            <div className="app-scroll relative min-h-0 flex-1 overflow-auto bg-[var(--color-background-surface-under)]">
              {frame ? (
                <StructureCanvas
                  frame={frame}
                  language={language}
                  memory={memory}
                  onSelect={setSelected}
                  previous={previous}
                  selected={selected}
                  speed={state.speed}
                  zoom={zoom}
                />
              ) : (
                <div className="grid h-full place-items-center px-8 text-center">
                  <div className="max-w-sm">
                    <div className="mx-auto grid size-11 place-items-center rounded-2xl border border-border bg-card">
                      <Eye className="size-4 text-muted-foreground" />
                    </div>
                    <h2 className="mt-3 text-[1.05rem] font-semibold tracking-[-0.02em]">Watch it run</h2>
                    <p className="mt-1 text-ui text-muted-foreground">
                      Open a problem or write a function, fill in the input, and Spar will step through the real execution — every variable, every pointer, every branch.
                    </p>
                    <div className="mt-4 flex items-center justify-center gap-2">
                      <Button disabled={state.status === "tracing"} onClick={() => void state.run()} size="sm">
                        <Play data-icon="inline-start" />
                        Run
                      </Button>
                      <Button onClick={() => setPicking(true)} size="sm" variant="outline">
                        <Library data-icon="inline-start" />
                        Pick a problem
                      </Button>
                    </div>
                  </div>
                </div>
              )}

              {state.stale && frame && (
                <div className="pointer-events-none sticky bottom-3 left-0 mx-auto w-fit rounded-full border border-border bg-popover px-3 py-1.5 text-ui text-muted-foreground shadow-[var(--app-shadow-overlay)]">
                  This trace is from before your last edit. Run again to update it.
                </div>
              )}
            </div>

            {verdict.tone !== "none" && (
              <div
                className={cn(
                  "flex items-start gap-2 border-t px-4 py-2.5 text-ui",
                  verdict.tone === "error" ? "border-destructive/30 bg-destructive/5 text-destructive" : "border-warning/30 bg-warning/5 text-warning",
                )}
                role="status"
              >
                <AlertCircle className="mt-px size-3.5 shrink-0" />
                <div className="min-w-0">
                  <p className="font-medium">{verdict.title}</p>
                  <pre className="mt-0.5 whitespace-pre-wrap break-words font-mono text-ui-sm opacity-90">{verdict.detail}</pre>
                </div>
              </div>
            )}

            <StepNarration frame={frame} language={language} note={note} previous={previous} />
            <Transport
              busy={state.status === "tracing"}
              count={count}
              index={state.index}
              onIndex={state.setIndex}
              onPlaying={state.setPlaying}
              onSpeed={state.setSpeed}
              onStep={state.step}
              playing={state.playing}
              speed={state.speed}
              stale={state.stale}
            />
          </Panel>

          <PaneHandle direction="vertical" />

          <Panel className="min-h-0" collapsedSize={0} collapsible defaultSize={32} minSize={12} order={2}>
            <Inspector frame={frame} language={language} onSelect={setSelected} previous={previous} selected={selected} trace={state.trace} />
          </Panel>
        </PanelGroup>
      </Panel>
      </PanelGroup>

      <ProblemPicker api={api} onOpenChange={setPicking} onPick={state.loadProblem} open={picking} />
    </>
  );
}
