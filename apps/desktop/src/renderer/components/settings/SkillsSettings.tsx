import { useCallback, useEffect, useMemo, useState } from "react";
import { ChevronRight, Copy, Ellipsis, FolderOpen, FolderInput, Pencil, Plus, Trash2 } from "lucide-react";
import type { SkillSummary, SparApi } from "../../../shared/api";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { message } from "@/lib/format";
import { cn } from "@/lib/utils";
import { Markdown } from "../agent/Markdown";
import { IconSkill } from "../agent/threadIcons";
import { skillTitle } from "../agent/toolSubject";
import { SettingsGroup, SettingsRowButton, SettingsSection } from "./layout";

type Detail = SkillSummary & { body: string };
type Draft = { name: string; description: string; body: string; previous?: string };

/**
 * Skills: what the agent can load on demand, and the learner's own additions.
 *
 * Laid out the way the reference lays its skills out, because it is the shape
 * that works: a list grouped by where each skill comes from, a row that is the
 * skill's mark, name and one-line description, and a page per skill for the
 * rare things you do to one — turn it off, read it, customise or remove it.
 * The switch is on that page rather than on every row: a column of switches
 * reads as a form to fill in, and turning a skill off is not something anyone
 * does in bulk.
 */
export function SkillsSettings({ api, onDetail }: { api: SparApi | undefined; onDetail?: (open: boolean) => void }) {
  const [skills, setSkills] = useState<SkillSummary[] | null>(null);
  const [open, setOpen] = useState<{ name: string; source: SkillSummary["source"] } | null>(null);
  const [editing, setEditing] = useState<Draft | null>(null);
  const [failure, setFailure] = useState("");

  const refresh = useCallback(async () => {
    if (!api) return;
    try {
      setSkills(await api.listSkills());
    } catch (cause) {
      setFailure(message(cause));
    }
  }, [api]);
  useEffect(() => { void refresh(); }, [refresh]);

  const importFolder = async () => {
    if (!api) return;
    setFailure("");
    try {
      const imported = await api.importSkill();
      await refresh();
      if (imported) setOpen({ name: imported.name, source: "user" });
    } catch (cause) {
      setFailure(message(cause));
    }
  };

  const saved = async (skill: SkillSummary) => {
    setEditing(null);
    await refresh();
    setOpen({ name: skill.name, source: "user" });
  };

  const selected = open && skills?.find((skill) => skill.name === open.name && skill.source === open.source);
  /* A skill's page takes the whole Agent page, breadcrumb and all, so the page
     around this has to know when to step aside — and to come back when this
     unmounts with a skill still open. */
  const showingDetail = Boolean(selected && api);
  useEffect(() => { onDetail?.(showingDetail); }, [onDetail, showingDetail]);
  useEffect(() => () => onDetail?.(false), [onDetail]);
  if (selected && api) {
    return (
      <>
        <SkillPage
          api={api}
          key={`${selected.source}:${selected.name}`}
          onBack={() => setOpen(null)}
          onChanged={refresh}
          onEdit={(draft) => setEditing(draft)}
          onOpen={(name, source) => setOpen({ name, source })}
          skill={selected}
        />
        <SkillDialog api={api} draft={editing} onClose={() => setEditing(null)} onSaved={saved} />
      </>
    );
  }

  const mine = skills?.filter((skill) => skill.source === "user") ?? [];
  const builtIn = skills?.filter((skill) => skill.source === "built-in") ?? [];

  return (
    <SettingsSection title="Skills">
      {failure && <p className="mb-3 rounded-xl border border-destructive/30 bg-destructive/5 px-3 py-2 text-ui text-destructive">{failure}</p>}
      {/* One card, the same shape as Providers above it: a row per skill, then
          the row that adds one. Where a skill comes from is a badge, not a
          heading — with one built-in, a heading per source was all heading. */}
      <SettingsGroup>
        {skills === null && <div className="h-[3.25rem] animate-pulse bg-[var(--surface-secondary)]" />}
        {[...mine, ...builtIn].map((skill) => (
          <SettingsRowButton className="group" key={`${skill.source}:${skill.name}`} onClick={() => setOpen({ name: skill.name, source: skill.source })}>
            <span className={cn("grid size-6 shrink-0 place-items-center", skill.enabled && !skill.overridden ? "text-foreground/85" : "text-muted-foreground/50")}>
              <IconSkill className="size-[1.15rem]" />
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex min-w-0 items-center gap-1.5">
                <span className={cn("truncate text-content font-medium", skill.enabled && !skill.overridden ? "text-foreground" : "text-muted-foreground")}>{skillTitle(skill.name)}</span>
                {skill.overridden ? <Badge>Overridden</Badge> : !skill.enabled ? <Badge>Off</Badge> : skill.source === "built-in" && <Badge>Built-in</Badge>}
              </div>
              <p className="truncate text-ui text-muted-foreground">{skill.description}</p>
            </div>
            <ChevronRight className="size-4 shrink-0 text-muted-foreground/40 transition-colors group-hover:text-muted-foreground" />
          </SettingsRowButton>
        ))}
        <DropdownMenu>
          <DropdownMenuTrigger
            className="flex min-h-[3.25rem] w-full items-center gap-3 bg-[var(--surface-secondary)] p-2.5 text-content text-muted-foreground transition-colors outline-none hover:bg-accent hover:text-foreground aria-expanded:bg-accent aria-expanded:text-foreground"
            disabled={!api}
          >
            <span className="grid size-6 shrink-0 place-items-center"><Plus className="size-[1.15rem]" /></span>
            Add a skill
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="min-w-[15rem]">
            <DropdownMenuItem onSelect={() => setEditing({ name: "", description: "", body: "" })}>
              <Pencil aria-hidden />
              Write a new skill
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => void importFolder()}>
              <FolderInput aria-hidden />
              Import a folder…
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={() => void api?.revealSkills()}>
              <FolderOpen aria-hidden />
              Open skills folder
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </SettingsGroup>

      <SkillDialog api={api} draft={editing} onClose={() => setEditing(null)} onSaved={saved} />
    </SettingsSection>
  );
}

function SkillAvatar({ dim = false, small = false }: { dim?: boolean; small?: boolean }) {
  return (
    <span
      className={cn(
        "grid shrink-0 place-items-center border border-border bg-secondary text-foreground/70 transition-opacity",
        small ? "size-5 rounded-[5px]" : "size-9 rounded-lg",
        dim && "opacity-55",
      )}
    >
      <IconSkill className={small ? "size-3" : "size-[1.15rem]"} />
    </span>
  );
}

function Badge({ children }: { children: React.ReactNode }) {
  return <span className="h-4 shrink-0 rounded px-1 text-[10px] leading-4 font-medium text-muted-foreground ring-1 ring-border">{children}</span>;
}

/**
 * One skill: where it comes from, what it tells the agent, and the switch.
 *
 * A built-in cannot be edited in place — it ships with the app and the next
 * update would put it back — so "Copy to customize" makes the learner's own
 * copy, which then overrides it. The original stays listed as overridden, and
 * deleting the copy is how it comes back.
 */
function SkillPage({ api, skill, onBack, onChanged, onEdit, onOpen }: {
  api: SparApi;
  skill: SkillSummary;
  onBack(): void;
  onChanged(): Promise<void>;
  onEdit(draft: Draft): void;
  onOpen(name: string, source: SkillSummary["source"]): void;
}) {
  const [detail, setDetail] = useState<Detail | null>(null);
  const [failure, setFailure] = useState("");
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);

  useEffect(() => {
    let alive = true;
    /* The read returns the skill that answers to the name, which for an
       overridden built-in is the learner's copy — so an overridden built-in is
       drawn from its summary and a note, not from the other skill's body. */
    if (skill.overridden) { setDetail({ ...skill, body: "" }); return; }
    void api.readSkill(skill.name).then((value) => { if (alive) setDetail(value); }).catch((cause) => { if (alive) setFailure(message(cause)); });
    return () => { alive = false; };
  }, [api, skill]);

  const act = async (work: () => Promise<unknown>) => {
    setBusy(true);
    setFailure("");
    try {
      await work();
    } catch (cause) {
      setFailure(message(cause));
    } finally {
      setBusy(false);
    }
  };

  const title = skillTitle(skill.name);
  const body = useMemo(() => (detail?.body ?? "").replace(/^#\s+.*\n+/, ""), [detail]);
  const heading = useMemo(() => /^#\s+(.*)$/m.exec(detail?.body ?? "")?.[1]?.trim() || title, [detail, title]);

  return (
    <div className="-mt-3">
      <div className="mb-6 flex h-8 items-center justify-between gap-3">
        <nav aria-label="Breadcrumb" className="flex min-w-0 items-center gap-1 text-ui">
          <button className="rounded-md px-1.5 py-0.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground" onClick={onBack} type="button">Agent</button>
          <ChevronRight className="size-3.5 shrink-0 text-muted-foreground/60" />
          <span className="flex min-w-0 items-center gap-1.5 px-1">
            <SkillAvatar small />
            <span className="max-w-60 truncate font-medium">{title}</span>
          </span>
        </nav>
        <div className="flex shrink-0 items-center gap-1">
          {!skill.overridden && (
            <Tooltip>
              <TooltipTrigger asChild>
                <span className="inline-flex items-center px-1.5">
                  <Switch
                    aria-label={skill.enabled ? "Do not use this skill" : "Use this skill"}
                    checked={skill.enabled}
                    disabled={busy}
                    onCheckedChange={(next) => void act(async () => { await api.setSkillEnabled({ name: skill.name, enabled: next }); await onChanged(); })}
                    size="sm"
                  />
                </span>
              </TooltipTrigger>
              <TooltipContent>{skill.enabled ? "Do not use this skill" : "Use this skill"}</TooltipContent>
            </Tooltip>
          )}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button aria-label="Skill actions" disabled={busy} size="icon-sm" variant="ghost"><Ellipsis /></Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-52">
              {skill.source === "built-in" && !skill.overridden && (
                <DropdownMenuItem onSelect={() => void act(async () => { const copy = await api.customizeSkill(skill.name); await onChanged(); onOpen(copy.name, "user"); })}>
                  <Copy aria-hidden />
                  Copy to customize
                </DropdownMenuItem>
              )}
              {skill.overridden && (
                <DropdownMenuItem onSelect={() => onOpen(skill.name, "user")}>
                  <Pencil aria-hidden />
                  Open your copy
                </DropdownMenuItem>
              )}
              {skill.source === "user" && detail && (
                <DropdownMenuItem onSelect={() => onEdit({ name: skill.name, description: skill.description, body: detail.body, previous: skill.name })}>
                  <Pencil aria-hidden />
                  Edit
                </DropdownMenuItem>
              )}
              <DropdownMenuItem onSelect={() => void api.revealSkills(skill.source === "user" || !skill.overridden ? skill.name : undefined)}>
                <FolderOpen aria-hidden />
                Show in Finder
              </DropdownMenuItem>
              {skill.source === "user" && (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onSelect={() => setConfirming(true)} variant="destructive">
                    <Trash2 aria-hidden />
                    Delete
                  </DropdownMenuItem>
                </>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      {failure && <p className="mb-4 rounded-xl border border-destructive/30 bg-destructive/5 px-3 py-2 text-ui text-destructive">{failure}</p>}

      <h2 className="mb-5 text-[26px] leading-8 font-semibold tracking-[-0.02em]">{heading}</h2>
      <dl className="mb-8 border-y border-border">
        <MetaRow label="Description">{skill.description}</MetaRow>
        <MetaRow label="Name"><code className="code-inline">{skill.name}</code></MetaRow>
        <MetaRow label="Source">
          {skill.source === "built-in" ? (skill.overridden ? "Built in to Spar — overridden by your copy, which the agent uses instead" : "Built in to Spar") : "Your skill"}
        </MetaRow>
        {!skill.enabled && !skill.overridden && <MetaRow label="Status">Off — the agent is not told this skill exists</MetaRow>}
      </dl>

      {detail === null && !failure && <div className="h-40 animate-pulse rounded-xl bg-[var(--surface-secondary)]" />}
      {detail && body && <Markdown className="md-prose-content text-sm" source={body} />}
      {detail && !body && !skill.overridden && <p className="text-ui text-muted-foreground">This skill has no instructions yet.</p>}

      <Dialog onOpenChange={setConfirming} open={confirming}>
        <DialogContent className="sm:max-w-[26rem]">
          <DialogHeader>
            <DialogTitle>Delete {title}?</DialogTitle>
            <DialogDescription>This removes the skill and its files.{skill.source === "user" ? " If it overrode a built-in skill, the built-in comes back." : ""}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button onClick={() => setConfirming(false)} variant="secondary">Cancel</Button>
            <Button
              onClick={() => void act(async () => { await api.removeSkill(skill.name); setConfirming(false); await onChanged(); onBack(); })}
              variant="destructive"
            >
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function MetaRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid min-h-9 grid-cols-[120px_1fr] items-start border-b border-border py-2 text-sm last:border-b-0">
      <dt className="font-medium text-muted-foreground">{label}</dt>
      <dd className="min-w-0 text-foreground/90">{children}</dd>
    </div>
  );
}

/** A skill name as the agent will use it: lowercase words joined by dashes. */
function slug(value: string): string {
  return value.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 48);
}

/**
 * Create and edit, one dialog. The name is typed as a person would say it and
 * saved as the slug the agent calls it by, shown under the field so the two
 * are never a surprise. Create stays off until all three parts are there: a
 * skill without a description is one the agent can never decide to use.
 */
function SkillDialog({ api, draft, onClose, onSaved }: { api: SparApi | undefined; draft: Draft | null; onClose(): void; onSaved(skill: SkillSummary): void }) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState("");

  useEffect(() => {
    if (!draft) return;
    setName(draft.previous ? skillTitle(draft.name) : draft.name);
    setDescription(draft.description);
    setBody(draft.body.replace(/^---[\s\S]*?---\s*/, ""));
    setFailure("");
  }, [draft]);

  const id = slug(name);
  const ready = Boolean(id && description.trim() && body.trim());
  const editing = Boolean(draft?.previous);

  const submit = async () => {
    if (!api || !ready) return;
    setBusy(true);
    setFailure("");
    try {
      onSaved(await api.saveSkill({ name: id, description: description.trim(), body, ...(draft?.previous ? { previous: draft.previous } : {}) }));
    } catch (cause) {
      setFailure(message(cause));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog onOpenChange={(next) => { if (!next) onClose(); }} open={draft !== null}>
      <DialogContent className="flex h-[min(46rem,calc(100vh-2rem))] flex-col overflow-hidden sm:max-w-3xl">
        <form className="flex min-h-0 w-full flex-1 flex-col gap-4" onSubmit={(event) => { event.preventDefault(); void submit(); }}>
          <DialogHeader>
            <DialogTitle>{editing ? "Edit skill" : "Create new skill"}</DialogTitle>
            <DialogDescription>The agent sees the name and description on every turn, and reads the instructions only when it loads the skill.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-3">
            <label className="grid gap-1.5">
              <span className="text-ui font-medium">Name</span>
              <Input autoFocus onChange={(event) => setName(event.target.value)} placeholder="e.g. Interview drills" value={name} />
              <span className="text-xs text-muted-foreground">{id ? <>The agent calls it <code className="code-inline">{id}</code>.</> : "Letters and numbers; spaces become dashes."}</span>
            </label>
            <label className="grid gap-1.5">
              <span className="text-ui font-medium">Description</span>
              <Input onChange={(event) => setDescription(event.target.value)} placeholder="When the agent should use this skill" value={description} />
            </label>
          </div>
          <label className="flex min-h-0 flex-1 flex-col gap-1.5">
            <span className="text-ui font-medium">Instructions</span>
            <Textarea
              className="min-h-44 flex-1 resize-none overflow-y-auto font-mono text-sm [field-sizing:fixed]"
              onChange={(event) => setBody(event.target.value)}
              placeholder="Describe the workflow, constraints, and expected outputs."
              value={body}
            />
          </label>
          {failure && <p className="text-ui text-destructive">{failure}</p>}
          <DialogFooter>
            <Button onClick={onClose} type="button" variant="secondary">Cancel</Button>
            <Button disabled={!ready || busy} type="submit">{editing ? "Save" : "Create"}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
