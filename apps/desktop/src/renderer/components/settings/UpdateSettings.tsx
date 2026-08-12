import { useEffect, useState } from "react";
import { Check, Download, Loader2, RefreshCw, ShieldCheck } from "lucide-react";
import type { SparApi, UpdateState } from "../../../shared/api";
import { Button } from "@/components/ui/button";
import { message } from "@/lib/format";

const STATUS: Record<UpdateState["status"], string> = {
  idle: "Ready to check",
  checking: "Checking for updates…",
  available: "Update available",
  downloading: "Downloading update…",
  installing: "Installing update…",
  current: "Spar is up to date",
  error: "Couldn’t check for updates",
  unsupported: "Available in packaged releases",
};

/** A read-only policy row: Spar always checks automatically. The controls are
 *  immediate actions, never a checkbox that can disable the safety guarantee. */
export function UpdateSettings({ api }: { api: SparApi | undefined }) {
  const [state, setState] = useState<UpdateState | null>(null);
  const [failure, setFailure] = useState("");

  useEffect(() => {
    if (!api) return;
    void api.updateState().then(setState).catch((cause) => setFailure(message(cause)));
    return api.onUpdateState(setState);
  }, [api]);

  const check = () => {
    if (!api) return;
    setFailure("");
    void api.checkForUpdate().catch((cause) => setFailure(message(cause)));
  };
  const download = () => {
    if (!api) return;
    setFailure("");
    void api.downloadUpdate().catch((cause) => setFailure(message(cause)));
  };

  const busy = state?.status === "checking" || state?.status === "downloading" || state?.status === "installing";
  const detail = state?.status === "available"
    ? `Spar ${state.version} is ready. Download it now and Spar will restart after saving your work.`
    : state?.status === "downloading"
      ? `${Math.round(state.percent ?? 0)}% downloaded. Spar will restart as soon as the verified update is ready.`
      : state?.status === "installing"
        ? "Saving your work and handing off to the verified installer."
        : state?.status === "error"
          ? state.message
          : state?.status === "unsupported"
            ? state.message
            : "Spar checks securely when it opens and every few hours while it is running.";

  return (
    <div className="flex items-center gap-4 px-4 py-3.5">
      <div className="grid size-9 shrink-0 place-items-center rounded-lg bg-accent text-foreground">
        {busy ? <Loader2 className="size-4 animate-spin" /> : state?.status === "current" ? <Check className="size-4 text-success" /> : <ShieldCheck className="size-4" />}
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-content font-medium">{state ? STATUS[state.status] : "Automatic updates"}</p>
        <p className="mt-0.5 text-ui leading-relaxed text-muted-foreground">{failure || detail}</p>
      </div>
      {state?.status === "available" ? (
        <Button disabled={!api} onClick={download} size="sm"><Download />Update now</Button>
      ) : (
        <Button disabled={!api || busy || state?.status === "unsupported"} onClick={check} size="sm" variant="secondary"><RefreshCw />Check now</Button>
      )}
    </div>
  );
}
