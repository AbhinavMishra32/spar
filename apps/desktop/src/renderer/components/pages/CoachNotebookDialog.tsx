import { useCallback, useEffect, useMemo, useState } from "react";
import { NotebookIcon } from "@phosphor-icons/react";
import { LEARNER_NOTEBOOK, type CoachNotebookVersion, type SparApi } from "../../../shared/api";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Segmented } from "@/components/ui/segmented";
import { Textarea } from "@/components/ui/textarea";
import { message, relativeTime } from "@/lib/format";
import { cn } from "@/lib/utils";
import { Markdown } from "../agent/Markdown";
import { DiffCounts, LineDiffView } from "../agent/NotebookView";

type Tab = "view" | "edit" | "history";
type Scope = "track" | "learner";

const EMPTY: Record<Scope, string> = {
  track: "Spar's coach keeps notes here about your progress on this Track — what you can do, what to revisit, and the plan. It reads them before every turn.",
  learner: "Spar's coach keeps notes here about you, whatever you are learning — how you like to be taught and what helps you. Every Track reads them.",
};

function author(version: CoachNotebookVersion): string {
  return version.author === "coach" ? "Coach" : "You";
}

/**
 * The coach's notebooks as the learner sees them from a Track: the one for this
 * Track and the one about the learner that every Track reads, each with a way to
 * correct it and every version it has been through.
 */
export function CoachNotebookDialog({ api, trackId }: { api: SparApi | undefined; trackId: string | null }) {
  const [open, setOpen] = useState(false);
  const [scope, setScope] = useState<Scope>("track");
  const [tab, setTab] = useState<Tab>("view");
  const [history, setHistory] = useState<CoachNotebookVersion[] | null>(null);
  const [error, setError] = useState("");
  const [draft, setDraft] = useState("");
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [selected, setSelected] = useState<number | null>(null);

  const latest = history?.[0] ?? null;
  const key = scope === "learner" ? LEARNER_NOTEBOOK : trackId;

  const load = useCallback(async () => {
    if (!api) return;
    setError("");
    try {
      const versions = await api.notebookHistory(key);
      const sorted = [...versions].sort((a, b) => b.version - a.version);
      /* History can be empty while a notebook still exists (an older store that
         kept only the latest), so the latest is read on its own as well. */
      if (sorted.length === 0) {
        const current = await api.readNotebook(key);
        if (current) sorted.push(current);
      }
      setHistory(sorted);
      setSelected((value) => value ?? sorted[0]?.version ?? null);
    } catch (cause) {
      setError(message(cause));
      setHistory([]);
    }
  }, [api, key]);

  useEffect(() => {
    if (!open) return;
    setTab("view");
    setSelected(null);
    setHistory(null);
    void load();
  }, [open, load]);

  const startEditing = () => {
    setDraft(latest?.markdown ?? "");
    setNote("");
    setTab("edit");
  };

  const save = async () => {
    if (!api) return;
    setSaving(true);
    setError("");
    try {
      const trimmed = note.trim();
      await api.writeNotebook({ trackId: key, markdown: draft, ...(trimmed ? { note: trimmed } : {}) });
      setSelected(null);
      await load();
      setTab("view");
    } catch (cause) {
      setError(message(cause));
    } finally {
      setSaving(false);
    }
  };

  const chosen = useMemo(() => history?.find((version) => version.version === selected) ?? history?.[0] ?? null, [history, selected]);
  const before = useMemo(() => {
    if (!history || !chosen) return null;
    return history.find((version) => version.version < chosen.version)?.markdown ?? null;
  }, [history, chosen]);

  const changed = draft !== (latest?.markdown ?? "");

  return (
    <Dialog onOpenChange={setOpen} open={open}>
      <DialogTrigger asChild>
        <Button variant="outline"><NotebookIcon data-icon="inline-start" weight="regular" />Coach's notebook</Button>
      </DialogTrigger>
      <DialogContent className="gap-4 sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Coach's notebook</DialogTitle>
          <DialogDescription>
            {latest ? `v${latest.version} · ${author(latest)} · ${relativeTime(latest.createdAt)}` : scope === "learner" ? "What Spar's coach knows about you, on every Track." : "What Spar's coach knows about your progress in this Track."}
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-wrap items-center justify-between gap-2">
          <Segmented<Scope>
            ariaLabel="Which notebook"
            className="w-fit"
            onChange={setScope}
            options={[
              { value: "track", label: "This Track" },
              { value: "learner", label: "About you" },
            ]}
            value={scope}
          />
          <Segmented<Tab>
            ariaLabel="Notebook view"
            className="w-fit"
            onChange={(value) => (value === "edit" ? startEditing() : setTab(value))}
            options={[
              { value: "view", label: "View" },
              { value: "edit", label: "Edit" },
              { value: "history", label: "History" },
            ]}
            value={tab}
          />
        </div>

        {error && <p className="text-ui-sm text-destructive" role="alert">{error}</p>}

        {tab === "view" && (
          history === null ? (
            <p className="text-ui text-muted-foreground" role="status">Opening the notebook…</p>
          ) : latest?.markdown.trim() ? (
            <div className="app-scroll max-h-[60vh] overflow-y-auto rounded-xl border border-border/70 px-4 py-3">
              <Markdown source={latest.markdown} />
            </div>
          ) : (
            <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-border px-6 py-10 text-center">
              <NotebookIcon className="size-6 text-muted-foreground" />
              <p className="max-w-md text-ui leading-[1.55] text-muted-foreground">{EMPTY[scope]}</p>
            </div>
          )
        )}

        {tab === "edit" && (
          <div className="flex flex-col gap-2">
            <Textarea
              autoFocus
              className="app-scroll min-h-[20rem] max-h-[55vh] resize-y font-mono text-[12.5px] leading-[1.6]"
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={(event) => { if (event.key === "Enter" && (event.metaKey || event.ctrlKey) && changed && !saving) { event.preventDefault(); void save(); } }}
              placeholder={"# How I learn\n\n- …"}
              spellCheck={false}
              value={draft}
            />
            <Input onChange={(event) => setNote(event.target.value)} placeholder="What did you change? (optional)" value={note} />
          </div>
        )}

        {tab === "history" && (
          history === null ? (
            <p className="text-ui text-muted-foreground" role="status">Opening the history…</p>
          ) : history.length === 0 ? (
            <p className="text-ui text-muted-foreground">No versions yet. {EMPTY[scope]}</p>
          ) : (
            <div className="grid min-h-0 grid-cols-[13rem_minmax(0,1fr)] gap-3">
              <ol className="app-scroll flex max-h-[55vh] flex-col gap-0.5 overflow-y-auto pr-1">
                {history.map((version) => (
                  <li key={version.version}>
                    <button
                      className={cn(
                        "flex w-full cursor-default flex-col gap-0.5 rounded-lg px-2.5 py-1.5 text-left outline-none transition-colors focus-visible:ring-1 focus-visible:ring-ring",
                        chosen?.version === version.version ? "bg-[var(--color-background-elevated-secondary)]" : "hover:bg-muted/60",
                      )}
                      onClick={() => setSelected(version.version)}
                      type="button"
                    >
                      <span className="flex items-center gap-1.5 text-ui-sm">
                        <span className="font-mono tabular-nums text-foreground">v{version.version}</span>
                        <span className="text-muted-foreground">{author(version)}</span>
                        <span className="ml-auto shrink-0 text-muted-foreground">{relativeTime(version.createdAt)}</span>
                      </span>
                      {version.note && <span className="line-clamp-2 text-ui-sm leading-[1.45] text-muted-foreground">{version.note}</span>}
                    </button>
                  </li>
                ))}
              </ol>
              {chosen && (
                <div className="flex min-w-0 flex-col overflow-hidden rounded-xl border border-border/70">
                  <div className="flex items-center gap-2 border-b border-border/60 px-3 py-1.5 text-ui-sm text-muted-foreground">
                    <span>{before === null ? `v${chosen.version} · first version` : `Changes in v${chosen.version}`}</span>
                    <DiffCounts after={chosen.markdown} before={before} className="ml-auto" />
                  </div>
                  <div className="app-scroll max-h-[50vh] overflow-y-auto">
                    <LineDiffView after={chosen.markdown} before={before} />
                  </div>
                </div>
              )}
            </div>
          )
        )}

        {tab === "edit" && (
          <DialogFooter>
            <Button onClick={() => setTab("view")} variant="ghost">Cancel</Button>
            <Button disabled={!api || saving || !changed} onClick={() => void save()}>
              {saving ? "Saving…" : "Save"} <kbd className="font-sans text-[10px] opacity-60">⌘↵</kbd>
            </Button>
          </DialogFooter>
        )}
        {tab === "view" && latest && (
          <DialogFooter>
            <Button onClick={startEditing} variant="outline">Edit notes</Button>
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  );
}
