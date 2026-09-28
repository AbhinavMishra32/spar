import { useEffect, useRef, useState } from "react";
import { ArrowRight, Check, Plus, SlidersHorizontal, X } from "lucide-react";
import { DEFAULT_CHALLENGE_MIX, challengeMixSchema, type ChallengeMix, type Language, type Lens, type LensDepth, type LensExample as LensExampleValue, type ProblemSource, type SessionSummary } from "@spar/domain";
import type { SparApi } from "../../../shared/api";
import { DEPTH_COPY, SPAR_CHOICES, customLensId, isDefaultMix, lensCatalogue, lensInfo, sparChoice, type LensInfo, type SparChoice } from "../../../shared/challengeMix";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Segmented } from "@/components/ui/segmented";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { SourceGlyph } from "../common/SourceGlyph";
import { SparDots } from "../common/SparDots";
import { LANGUAGE_LABEL } from "../common/LanguageGlyph";
import { message } from "@/lib/format";
import { cn } from "@/lib/utils";
import { usePracticeSources } from "@/hooks/use-practice-sources";

/**
 * The session's coaching settings, from the challenge toolbar.
 *
 * Three things, each one question:
 * - Problems: when Spar writes one, as a single ladder from never to always,
 *   with the two real sources beside it. The ladder's ends are the sources
 *   themselves, so the two can never disagree.
 * - Go deeper on: lenses the coach brings in at a depth — a line in feedback,
 *   teaching, or Spar problems that drill it — plus the ones it suggests from
 *   what it saw in their code.
 * - Custom instructions: the learner's own words, added to the coach's.
 *
 * Every change saves as it is made and the next coach turn reads it. The panel
 * keeps its own copy while open so a control answers on the frame it is
 * touched, and the session is re-read once when it closes.
 */
export function ChallengeMixMenu({ api, session, language, onChanged, onConnect, onError }: {
  api: SparApi | undefined;
  session: SessionSummary;
  language: Language;
  onChanged(): void;
  /** Opens Settings at the practice sources. */
  onConnect?: (() => void) | undefined;
  onError(message: string): void;
}) {
  const [open, setOpen] = useState(false);
  const [sources, setSources] = useState<ProblemSource[]>(session.problemSources);
  const [mix, setMix] = useState<ChallengeMix>(readMix(session.challengeMix));
  const [saved, setSaved] = useState(0);
  const dirty = useRef(false);
  const textTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latestMix = useRef(mix);
  latestMix.current = mix;

  /* While closed, the session is the truth: the coach may have changed it with
     set_challenge_mix since the panel was last open. */
  useEffect(() => {
    if (open) return;
    setSources(session.problemSources);
    setMix(readMix(session.challengeMix));
  }, [open, session.id, session.problemSources, session.challengeMix]);

  const done = () => setSaved((count) => count + 1);
  const fail = (cause: unknown) => onError(message(cause));

  const writeSources = (next: ProblemSource[]) => {
    if (next.join() === sources.join()) return;
    setSources(next);
    dirty.current = true;
    void api?.setSessionProblemSources({ sessionId: session.id, sources: next }).then(done).catch(fail);
  };

  const writeMix = (next: ChallengeMix, delay = 0) => {
    setMix(next);
    dirty.current = true;
    if (textTimer.current) clearTimeout(textTimer.current);
    const write = () => { textTimer.current = null; void api?.setSessionChallengeMix({ sessionId: session.id, mix: next }).then(done).catch(fail); };
    if (delay) textTimer.current = setTimeout(write, delay);
    else write();
  };

  /* The ladder's ends move the sources; the middle needs both kinds allowed. */
  const choose = (choice: SparChoice) => {
    const external = sources.filter((source) => source !== "spar");
    if (choice === "never") writeSources(external.length ? external : ["leetcode"]);
    else if (choice === "always") writeSources(["spar"]);
    else {
      writeSources(["spar", ...(external.length ? external : ["leetcode" as const])]);
      if (mix.sparUse !== choice) writeMix({ ...mix, sparUse: choice });
    }
  };

  const toggleSource = (source: "leetcode" | "codeforces", on: boolean) => {
    const next = on ? [...sources, source] : sources.filter((entry) => entry !== source);
    writeSources((["spar", "leetcode", "codeforces"] as const).filter((entry) => next.includes(entry)));
  };

  const onOpenChange = (next: boolean) => {
    setOpen(next);
    if (next || !dirty.current) return;
    dirty.current = false;
    /* A pending text save lands before the re-read, not after it. */
    if (textTimer.current) {
      clearTimeout(textTimer.current);
      textTimer.current = null;
      void api?.setSessionChallengeMix({ sessionId: session.id, mix: latestMix.current }).catch(fail).finally(onChanged);
    } else onChanged();
  };

  const inventory = usePracticeSources(api);
  const choice = sparChoice(sources, mix);
  /* With every source allowed, the host only uses the ones that are signed in,
     so a real problem needs one that is. */
  const noRealSource = !!inventory && choice !== "always" && !inventory.some((entry) => entry.state === "connected" && sources.includes(entry.source));
  const customised = !isDefaultMix(mix) || sources.length < 3;

  return (
    <Popover onOpenChange={onOpenChange} open={open}>
      <PopoverTrigger asChild>
        <button
          aria-label="Coaching settings"
          className="group inline-flex h-6 items-center gap-1.5 rounded-md pl-1.5 pr-2 text-ui text-muted-foreground transition-colors hover:bg-accent hover:text-foreground data-[state=open]:bg-accent data-[state=open]:text-foreground"
          title="Coaching settings"
          type="button"
        >
          <SlidersHorizontal className="size-3.5" />
          {/* What is on, as a stack of marks: the trigger says what the panel is
              set to before anyone opens it. */}
          <span className="flex items-center -space-x-1">
            {sources.map((source) => (
              <span className="grid size-4 place-items-center rounded-full bg-[var(--color-background-elevated-secondary)] ring-2 ring-background" key={source}>
                <SourceMark size={10} source={source} />
              </span>
            ))}
          </span>
          {customised && <span aria-hidden className="size-1 rounded-full bg-current opacity-60" />}
        </button>
      </PopoverTrigger>

      <PopoverContent className="w-[22.5rem] overflow-hidden p-0" collisionPadding={12}>
        <div className="flex max-h-[min(34rem,calc(100vh-6rem))] flex-col">
          <header className="flex items-center gap-2 px-3.5 pb-1.5 pt-3">
            <h2 className="min-w-0 flex-1 text-content font-semibold tracking-[-0.01em]">Coaching</h2>
            <SavedTick saved={saved} />
          </header>

          <div className="app-scroll min-h-0 flex-1 overflow-y-auto px-3.5 pb-3.5">
            <Section title="Problems">
              <div className="divide-y divide-border/70 overflow-hidden rounded-[var(--radius-lg)] border border-border/80">
                <div className="px-3 py-2">
                  <div className="flex items-center gap-2.5">
                    <SourceMark size={15} source="spar" />
                    <span className="min-w-0 flex-1 text-ui font-medium">Spar problems</span>
                    <Select onValueChange={(value) => choose(value as SparChoice)} value={choice}>
                      <SelectTrigger aria-label="When to use Spar problems" className="h-7 border-transparent bg-transparent pr-1.5 text-ui shadow-none hover:bg-accent dark:bg-transparent" size="sm">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {SPAR_CHOICES.map((entry) => <SelectItem key={entry.value} value={entry.value}>{entry.title}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                  <p className="mt-0.5 pl-[1.6rem] text-ui-sm text-muted-foreground">
                    {noRealSource ? "Connect LeetCode or Codeforces to mix in real problems." : SPAR_CHOICES.find((entry) => entry.value === choice)?.detail}
                  </p>
                </div>
                {(["leetcode", "codeforces"] as const).map((source) => {
                  const on = sources.includes(source);
                  const state = inventory?.find((entry) => entry.source === source)?.state ?? null;
                  /* Spar off and this the only source left: turning it off
                     would leave nowhere to take a problem from. */
                  const last = on && sources.length === 1;
                  const name = source === "leetcode" ? "LeetCode" : "Codeforces";
                  if (state && state !== "connected") {
                    return (
                      <div className="flex items-center gap-2.5 px-3 py-1.5" key={source}>
                        <SourceMark size={15} source={source} />
                        <span className="min-w-0 flex-1">
                          <span className="block text-ui font-medium">{name}</span>
                          <span className="block text-ui-sm text-muted-foreground">{state === "expired" ? "Signed out" : "Not connected"}</span>
                        </span>
                        <Button onClick={() => { onOpenChange(false); onConnect?.(); }} size="xs" variant="secondary">
                          {state === "expired" ? "Reconnect" : "Connect"}
                        </Button>
                      </div>
                    );
                  }
                  return (
                    <label className={cn("flex items-center gap-2.5 px-3 py-1.5", last ? "cursor-default" : "cursor-pointer")} key={source} title={last ? "A session needs somewhere to take problems from" : undefined}>
                      <SourceMark size={15} source={source} />
                      <span className="min-w-0 flex-1 text-ui font-medium">{name}</span>
                      {state
                        ? <Switch checked={on} disabled={last} onCheckedChange={(next) => toggleSource(source, next)} size="sm" />
                        : <SparDots className="text-muted-foreground/60" pattern="pulse" size={14} />}
                    </label>
                  );
                })}
              </div>
            </Section>

            <Section title="Go deeper on">
              <Lenses language={language} mix={mix} onChange={(next) => writeMix(next)} sparOn={choice !== "never"} />
            </Section>

            <Section title="Custom instructions">
              <Instructions language={language} onChange={(instructions) => writeMix({ ...mix, instructions }, 500)} value={mix.instructions} />
            </Section>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}

const DEPTHS: LensDepth[] = ["mention", "teach", "drill"];

function Lenses({ language, mix, sparOn, onChange }: { language: Language; mix: ChallengeMix; sparOn: boolean; onChange(next: ChallengeMix): void }) {
  const catalogue = lensCatalogue(language);
  const active = new Set(mix.lenses.map((lens) => lens.id));
  const add = (lens: Lens) => onChange({
    ...mix,
    lenses: [...mix.lenses.filter((entry) => entry.id !== lens.id), lens],
    suggestions: mix.suggestions.filter((entry) => entry.id !== lens.id),
  });
  const setDepth = (id: string, depth: LensDepth) => onChange({ ...mix, lenses: mix.lenses.map((lens) => (lens.id === id ? { ...lens, depth } : lens)) });
  const remove = (id: string) => onChange({ ...mix, lenses: mix.lenses.filter((lens) => lens.id !== id) });
  const dismiss = (id: string) => onChange({ ...mix, suggestions: mix.suggestions.filter((entry) => entry.id !== id), dismissed: [...new Set([...mix.dismissed, id])] });

  return (
    <div className="flex flex-col gap-2.5">
      {mix.suggestions.map((suggestion) => {
        const label = suggestion.label ?? lensInfo(suggestion, language)?.label ?? suggestion.id;
        return (
          <div className="flex items-start gap-2.5 rounded-[var(--radius-lg)] border border-border/70 bg-[var(--color-background-elevated-secondary)] px-3 py-2.5" key={suggestion.id}>
            <SparDots className="mt-0.5 text-foreground/80" pattern="still" size={13} />
            <div className="min-w-0 flex-1">
              <p className="text-ui"><span className="text-muted-foreground">Coach suggests</span> <span className="font-medium">{label}</span></p>
              <p className="mt-0.5 text-ui-sm text-muted-foreground">{suggestion.reason}</p>
              {suggestion.example && <CodeShift example={suggestion.example} />}
              <div className="mt-2 flex gap-1.5">
                <Button onClick={() => add({ id: suggestion.id, depth: "teach", ...(suggestion.label ? { label: suggestion.label } : {}), ...(suggestion.example ? { example: suggestion.example } : {}) })} size="xs">Add lens</Button>
                <Button onClick={() => dismiss(suggestion.id)} size="xs" variant="ghost">Not now</Button>
              </div>
            </div>
          </div>
        );
      })}

      {mix.lenses.length > 0 && (
        <div className="divide-y divide-border/70 overflow-hidden rounded-[var(--radius-lg)] border border-border/80">
          {mix.lenses.map((lens) => {
            const info = lensInfo(lens, language);
            if (!info) return null;
            const depth: LensDepth = lens.depth === "drill" && !sparOn ? "teach" : lens.depth;
            return (
              <div className="group px-3 py-1.5" key={lens.id}>
                <div className="flex items-center gap-2">
                  <span className="min-w-0 flex-1 truncate text-ui font-medium" title={`${info.label} · ${DEPTH_COPY[depth].detail}`}>{info.label}</span>
                  <button
                    aria-label={`Remove ${info.label}`}
                    className="grid size-5 place-items-center rounded-[var(--radius-sm)] text-muted-foreground/70 opacity-0 transition-opacity hover:bg-accent hover:text-foreground focus-visible:opacity-100 group-hover:opacity-100"
                    onClick={() => remove(lens.id)}
                    type="button"
                  >
                    <X className="size-3" />
                  </button>
                  <Segmented
                    ariaLabel={`How deep to go on ${info.label}`}
                    className="w-[9.25rem] [&_button]:h-[1.375rem] [&_button]:px-1 [&_button]:text-ui-sm"
                    onChange={(next) => setDepth(lens.id, next)}
                    options={DEPTHS.map((value) => ({
                      value,
                      label: DEPTH_COPY[value].label,
                      title: value === "drill" && !sparOn ? "Drilling needs Spar problems" : DEPTH_COPY[value].detail,
                      disabled: value === "drill" && !sparOn,
                    }))}
                    value={depth}
                  />
                </div>
                <LensExample depth={depth} example={lens.example} />
              </div>
            );
          })}
        </div>
      )}

      <div className="flex flex-col gap-1.5">
        {!mix.lenses.length && <p className="text-ui-sm text-muted-foreground">Pick what your coach should dig into along the way.</p>}
        <AddRow label={LANGUAGE_LABEL[language]} lenses={catalogue.language.filter((lens) => !active.has(lens.id))} onAdd={(id) => add({ id, depth: "teach" })} />
        <AddRow label="Craft" lenses={catalogue.craft.filter((lens) => !active.has(lens.id))} onAdd={(id) => add({ id, depth: "teach" })}>
          <CustomLens onAdd={(label) => add({ id: customLensId(label), label, depth: "teach" })} />
        </AddRow>
      </div>
    </div>
  );
}

/**
 * What the lens changes, in the learner's own code: the coach attaches the
 * before and after when it applies or suggests a lens.
 */
function LensExample({ example, depth }: { example: LensExampleValue | undefined; depth: LensDepth }) {
  /* Without one the row is just its name and depth; what the depth does is on
     the control's own tooltip, not repeated under every row. */
  if (!example) return null;
  return <CodeShift example={example} title={`From your code · ${DEPTH_COPY[depth].detail}`} />;
}

function CodeShift({ example, title }: { example: LensExampleValue; title?: string }) {
  return (
    <p className="mt-1 flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-0.5 font-mono text-[0.6875rem] leading-tight" title={title}>
      {example.before && (
        <>
          <span className="max-w-full truncate text-muted-foreground/70 line-through decoration-muted-foreground/40">{example.before}</span>
          <ArrowRight className="size-3 shrink-0 text-muted-foreground/60" />
        </>
      )}
      <span className="max-w-full truncate text-foreground/80">{example.after}</span>
    </p>
  );
}

function AddRow({ label, lenses, onAdd, children }: { label: string; lenses: LensInfo[]; onAdd(id: string): void; children?: React.ReactNode }) {
  if (!lenses.length && !children) return null;
  return (
    <div>
      <p className="mb-1 text-ui-sm text-muted-foreground/80">{label}</p>
      <div className="flex flex-wrap gap-1">
        {lenses.map((lens) => (
          <button className={CHIP} key={lens.id} onClick={() => onAdd(lens.id)} title={lens.about} type="button">
            <Plus className="size-3 text-muted-foreground" />
            {lens.label}
          </button>
        ))}
        {children}
      </div>
    </div>
  );
}

/* The concept chip's shape, so an addable lens reads as one of the app's tags. */
const CHIP = "inline-flex items-center gap-1 rounded-md border border-border/70 bg-[var(--color-background-elevated-secondary)] px-1.5 py-0.5 text-ui-sm text-foreground/75 transition-colors outline-none hover:border-[var(--border-strong)] hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/60";

function CustomLens({ onAdd }: { onAdd(label: string): void }) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState("");
  const submit = () => { const label = text.trim(); if (label) onAdd(label.slice(0, 60)); setText(""); setEditing(false); };
  if (!editing) {
    return (
      <button className={cn(CHIP, "border-dashed bg-transparent text-muted-foreground")} onClick={() => setEditing(true)} type="button">
        <Plus className="size-3" />
        Your own
      </button>
    );
  }
  return (
    <input
      aria-label="Name a lens"
      autoFocus
      className="h-[1.375rem] w-40 rounded-md border border-ring bg-transparent px-1.5 text-ui-sm outline-none ring-2 ring-ring/30 placeholder:text-muted-foreground/60"
      maxLength={60}
      onBlur={submit}
      onChange={(event) => setText(event.target.value)}
      onKeyDown={(event) => { if (event.key === "Enter") submit(); if (event.key === "Escape") { setText(""); setEditing(false); } }}
      placeholder="e.g. Bit tricks"
      value={text}
    />
  );
}

function Instructions({ language, value, onChange }: { language: Language; value: string; onChange(next: string): void }) {
  const [text, setText] = useState(value);
  useEffect(() => setText(value), [value]);
  return (
    <div>
      <textarea
        aria-label="Custom instructions"
        className="block max-h-40 min-h-[3.75rem] w-full resize-none rounded-[var(--radius-lg)] border border-input bg-transparent px-2.5 py-2 text-ui leading-[1.5] outline-none transition-colors [field-sizing:content] placeholder:text-muted-foreground/65 focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/40 dark:bg-input/30"
        maxLength={2000}
        onChange={(event) => { setText(event.target.value); onChange(event.target.value); }}
        placeholder={`Anything your coach should always do. e.g. "Always give me a TreeNode class", "Show one ${LANGUAGE_LABEL[language]} trick per problem"`}
        value={text}
      />
      <p className="mt-1 text-ui-sm text-muted-foreground/80">Added to your coach's instructions for this session.</p>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mt-3.5 first:mt-0.5">
      <h3 className="mb-1.5 text-[0.6875rem] font-semibold uppercase tracking-[0.07em] text-muted-foreground/75">{title}</h3>
      {children}
    </section>
  );
}

/** A tick that shows for a moment after each save. */
function SavedTick({ saved }: { saved: number }) {
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    if (!saved) return;
    setVisible(true);
    const timer = setTimeout(() => setVisible(false), 1400);
    return () => clearTimeout(timer);
  }, [saved]);
  return (
    <span className={cn("inline-flex shrink-0 items-center gap-1 text-ui-sm text-success transition-opacity duration-300", visible ? "opacity-100" : "opacity-0")}>
      <Check className="size-3" strokeWidth={2.5} />
      Saved
    </span>
  );
}

/* Spar is drawn with its own mark, the grid the app icon is made of. */
function SourceMark({ source, size }: { source: ProblemSource; size: number }) {
  return source === "spar"
    ? <SparDots className="text-foreground/85" pattern="still" size={size} />
    : <SourceGlyph className={size <= 10 ? "size-2.5 shrink-0" : "size-[0.95rem] shrink-0"} source={source} />;
}

/* A summary from a main process that has not restarted onto the current shape,
   or a row written by an older one, is read as far as it goes and defaulted
   past that — the panel never trusts the wire shape as-is. */
function readMix(value: unknown): ChallengeMix {
  const parsed = challengeMixSchema.safeParse(value ?? {});
  return parsed.success ? parsed.data : DEFAULT_CHALLENGE_MIX;
}
