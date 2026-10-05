import { useEffect, useRef, useState } from "react";
import { IconArrowInbox, IconExclamationTriangle } from "central-icons";
import type { SparApi, UpdateState } from "../../../shared/api";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Markdown } from "@/components/agent/Markdown";
import { SparDots } from "@/components/common/SparDots";
import { dismissToast, toast } from "@/hooks/use-toasts";
import { message } from "@/lib/format";

const KEY = "spar-update";

function bytes(value: number | null) {
  if (value === null) return null;
  const units = ["B", "KB", "MB", "GB"];
  let amount = value;
  let unit = 0;
  while (amount >= 1_024 && unit < units.length - 1) { amount /= 1_024; unit += 1; }
  return `${amount >= 10 || unit === 0 ? amount.toFixed(0) : amount.toFixed(1)} ${units[unit]}`;
}

/**
 * Release notes as they read inside the app. The published notes open with the
 * release's own title — which the dialog already says — and end with a
 * downloads table that means nothing to someone who is updating in place.
 */
function inAppNotes(notes: string): string {
  const trimmed = notes
    .replace(/^\s*#\s+[^\n]*\n+/, "")
    .replace(/\n##\s+Downloads\b[\s\S]*?(?=\n##\s|$)/i, "\n")
    .trim();
  /* The notes are written hard-wrapped, and the in-app renderer reads every
     line break as one — so a list item's second line fell out of the list.
     A line that does not start a block of its own joins the one before it. */
  const joined: string[] = [];
  for (const line of trimmed.split("\n")) {
    const previous = joined[joined.length - 1];
    const startsBlock = /^\s*(?:[-*+]\s|\d+[.)]\s|#|>|\||```)/.test(line);
    if (previous !== undefined && previous.trim() && line.trim() && !startsBlock && !previous.trimStart().startsWith("|")) {
      joined[joined.length - 1] = `${previous} ${line.trim()}`;
    } else {
      joined.push(line);
    }
  }
  return joined.join("\n");
}

/** The global update surface. Progress goes through the app's own toast, the
 *  same one every other notice uses; the notes open in a plain dialog. It stays
 *  mounted across navigation so a download keeps reporting while you work. */
export function UpdateExperience({ api }: { api: SparApi }) {
  const [state, setState] = useState<UpdateState | null>(null);
  const [notesOpen, setNotesOpen] = useState(false);
  /* The status the toast last showed. The offer is posted when an update
     becomes available — not again on every state push while it stays so — so
     closing it keeps it closed, and a retry after a failure posts it afresh. */
  const shown = useRef<UpdateState["status"] | null>(null);

  useEffect(() => {
    void api.updateState().then(setState).catch(() => undefined);
    return api.onUpdateState(setState);
  }, [api]);

  const update = async () => {
    setNotesOpen(false);
    try { await api.downloadUpdate(); }
    catch (cause) { toast({ key: KEY, title: "Update didn’t download", detail: message(cause), tone: "danger", glyph: <IconExclamationTriangle />, duration: 0 }); }
  };

  useEffect(() => {
    if (!state) return;
    const version = state.version ?? "";
    const previous = shown.current;
    shown.current = state.status;
    switch (state.status) {
      case "available":
        if (previous === "available") return;
        toast({
          key: KEY,
          title: `Spar ${version} is available`,
          detail: "Spar restarts to install it",
          glyph: <IconArrowInbox />,
          action: { label: "Update", onClick: () => void update() },
          onClick: () => setNotesOpen(true),
          duration: 0,
        });
        return;
      case "downloading": {
        const of = bytes(state.transferred) && bytes(state.total) ? `${bytes(state.transferred)} of ${bytes(state.total)}` : `${Math.round(state.percent ?? 0)}%`;
        toast({ key: KEY, title: `Downloading Spar ${version}`, detail: of, glyph: <SparDots pattern="wave" size={16} />, progress: state.percent ?? 0, duration: 0 });
        return;
      }
      case "installing":
        toast({ key: KEY, title: "Restarting to update", detail: "Saving your work first", glyph: <SparDots pattern="wave" size={16} />, progress: 100, duration: 0 });
        return;
      case "error":
        toast({
          key: KEY,
          title: "Update didn’t install",
          detail: state.message ?? undefined,
          tone: "danger",
          glyph: <IconExclamationTriangle />,
          action: { label: "Retry", onClick: () => void api.checkForUpdate() },
          duration: 0,
        });
        return;
      default:
        dismissToast(KEY);
    }
    // `update` closes over `api`, which is the dependency that matters here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state, api]);

  const dismissChangelog = () => {
    if (!state?.changelog) return;
    void api.dismissUpdateChangelog(state.changelog.version).catch(() => undefined);
  };

  return (
    <>
      <Dialog open={notesOpen && state?.status === "available"} onOpenChange={setNotesOpen}>
        <DialogContent className="sm:max-w-[34rem]">
          <DialogHeader>
            <DialogTitle>Spar {state?.version}</DialogTitle>
            <DialogDescription>You have {state?.currentVersion}. Spar saves your work and restarts to install it.</DialogDescription>
          </DialogHeader>
          <div className="app-scroll -mx-1 max-h-[22rem] overflow-y-auto px-1">
            {state?.notes ? <Markdown source={inAppNotes(state.notes)} /> : <p className="text-ui text-muted-foreground">No notes were published for this release.</p>}
          </div>
          <DialogFooter>
            <Button onClick={() => setNotesOpen(false)} variant="secondary">Later</Button>
            <Button onClick={() => void update()}>Update</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(state?.changelog)} onOpenChange={(open) => { if (!open) dismissChangelog(); }}>
        <DialogContent className="sm:max-w-[34rem]">
          <DialogHeader>
            <DialogTitle>Updated to {state?.changelog?.version}</DialogTitle>
            <DialogDescription>What changed in this version.</DialogDescription>
          </DialogHeader>
          <div className="app-scroll -mx-1 max-h-[24rem] overflow-y-auto px-1">
            {state?.changelog && <Markdown source={inAppNotes(state.changelog.notes)} />}
          </div>
          <DialogFooter>
            <Button onClick={dismissChangelog}>Done</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
