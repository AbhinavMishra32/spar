import { useEffect, useRef, useState } from "react";
import { ArrowRight, Check, Download, RefreshCw, ShieldCheck, Sparkles } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import type { SparApi, UpdateState } from "../../../shared/api";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Markdown } from "@/components/agent/Markdown";
import { SparDots } from "@/components/common/SparDots";
import { message } from "@/lib/format";

function bytes(value: number | null) {
  if (value === null) return null;
  const units = ["B", "KB", "MB", "GB"];
  let amount = value;
  let unit = 0;
  while (amount >= 1_024 && unit < units.length - 1) { amount /= 1_024; unit += 1; }
  return `${amount >= 10 || unit === 0 ? amount.toFixed(0) : amount.toFixed(1)} ${units[unit]}`;
}

function UpdateMark({ busy = false }: { busy?: boolean }) {
  return (
    <div className="grid size-11 shrink-0 place-items-center rounded-xl bg-foreground text-background shadow-[var(--app-shadow-card)]">
      {busy ? <SparDots className="text-background" pattern="wave" size={21} /> : <Sparkles className="size-5" />}
    </div>
  );
}

/** The global update surface. It stays mounted independently of navigation so a
 *  download started in Settings keeps its progress while the learner works. */
export function UpdateExperience({ api }: { api: SparApi }) {
  const [state, setState] = useState<UpdateState | null>(null);
  const [offer, setOffer] = useState(false);
  const [failure, setFailure] = useState("");
  const offered = useRef<string | null>(null);

  useEffect(() => {
    void api.updateState().then(setState).catch(() => undefined);
    return api.onUpdateState(setState);
  }, [api]);

  useEffect(() => {
    if (state?.status !== "available" || !state.version || offered.current === state.version) return;
    offered.current = state.version;
    setOffer(true);
  }, [state]);

  const update = async () => {
    setFailure("");
    setOffer(false);
    try { await api.downloadUpdate(); }
    catch (cause) { setFailure(message(cause)); }
  };

  const dismissChangelog = () => {
    if (!state?.changelog) return;
    void api.dismissUpdateChangelog(state.changelog.version).catch(() => undefined);
  };

  const visible = state && ["available", "downloading", "installing", "error"].includes(state.status);
  const progress = state?.percent ?? 0;

  return (
    <>
      <AnimatePresence>
        {visible && (
          <motion.aside
            animate={{ opacity: 1, y: 0, scale: 1 }}
            className="app-no-drag fixed right-4 top-12 z-40 w-[min(24rem,calc(100vw-2rem))] overflow-hidden rounded-2xl border border-foreground/10 bg-popover/96 shadow-[var(--app-shadow-overlay)] supports-backdrop-filter:backdrop-blur-xl"
            exit={{ opacity: 0, y: -10, scale: 0.98 }}
            initial={{ opacity: 0, y: -10, scale: 0.98 }}
            role="status"
          >
            {state.status === "downloading" && (
              <motion.div className="h-0.5 bg-foreground" initial={{ width: 0 }} animate={{ width: `${progress}%` }} />
            )}
            <div className="flex items-start gap-3 p-3.5">
              <UpdateMark busy={state.status === "downloading" || state.status === "installing"} />
              <div className="min-w-0 flex-1 pt-0.5">
                <p className="font-heading text-sm font-medium text-foreground">
                  {state.status === "available" && `Spar ${state.version} is ready`}
                  {state.status === "downloading" && `Downloading Spar ${state.version}`}
                  {state.status === "installing" && "Finishing your update"}
                  {state.status === "error" && "Update paused"}
                </p>
                <p className="mt-1 text-ui leading-relaxed text-muted-foreground">
                  {state.status === "available" && "A fresh round is waiting. Spar will save your work, restart, and bring you straight back."}
                  {state.status === "downloading" && `${Math.round(progress)}%${bytes(state.transferred) && bytes(state.total) ? ` · ${bytes(state.transferred)} of ${bytes(state.total)}` : ""}${bytes(state.bytesPerSecond) ? ` · ${bytes(state.bytesPerSecond)}/s` : ""}`}
                  {state.status === "installing" && "Download verified. Saving your active work before Spar restarts."}
                  {state.status === "error" && (state.message ?? failure ?? "Spar could not complete the update.")}
                </p>
                {state.status === "available" && (
                  <div className="mt-3 flex items-center gap-2">
                    <Button onClick={() => void update()} size="sm"><Download />Update now</Button>
                    {state.notes && <Button onClick={() => setOffer(true)} size="sm" variant="ghost">What’s new</Button>}
                  </div>
                )}
                {state.status === "error" && (
                  <Button className="mt-3" onClick={() => void api.checkForUpdate()} size="sm" variant="secondary"><RefreshCw />Try again</Button>
                )}
              </div>
            </div>
          </motion.aside>
        )}
      </AnimatePresence>

      <Dialog open={offer && state?.status === "available"} onOpenChange={setOffer}>
        <DialogContent className="overflow-hidden p-0 sm:max-w-[34rem]">
          <div className="relative overflow-hidden border-b border-border/70 px-6 pb-5 pt-6">
            <div aria-hidden className="absolute -right-16 -top-20 size-56 rounded-full bg-foreground/[0.045] blur-2xl" />
            <UpdateMark />
            <DialogHeader className="mt-5">
              <DialogTitle className="text-xl">A new round for Spar</DialogTitle>
              <DialogDescription>Spar {state?.version} is ready to download. Your sessions and open work are saved before the restart.</DialogDescription>
            </DialogHeader>
          </div>
          <div className="app-scroll max-h-[19rem] overflow-y-auto px-6 py-4">
            {state?.notes ? <Markdown source={state.notes} /> : <p className="text-ui text-muted-foreground">This release includes improvements and fixes across Spar.</p>}
          </div>
          <DialogFooter className="m-0 rounded-none px-6">
            <Button onClick={() => setOffer(false)} variant="secondary">Later</Button>
            <Button onClick={() => void update()}><Download />Update and restart<ArrowRight /></Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(state?.changelog)} onOpenChange={(open) => { if (!open) dismissChangelog(); }}>
        <DialogContent className="overflow-hidden p-0 sm:max-w-[36rem]">
          <div className="relative border-b border-border/70 px-6 pb-5 pt-6">
            <div aria-hidden className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-foreground/50 to-transparent" />
            <div className="flex items-center gap-3">
              <div className="grid size-10 place-items-center rounded-full bg-success/12 text-success"><Check className="size-5" /></div>
              <div>
                <DialogTitle className="text-xl">Spar just got better</DialogTitle>
                <DialogDescription className="mt-1">You’re now on version {state?.changelog?.version}.</DialogDescription>
              </div>
            </div>
          </div>
          <div className="app-scroll max-h-[22rem] overflow-y-auto px-6 py-5">
            {state?.changelog && <Markdown source={state.changelog.notes} />}
          </div>
          <DialogFooter className="m-0 items-center rounded-none px-6 sm:justify-between">
            <span className="hidden items-center gap-1.5 text-ui text-muted-foreground sm:flex"><ShieldCheck className="size-3.5" />Installed and verified</span>
            <Button onClick={dismissChangelog}>Let’s spar <ArrowRight /></Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
