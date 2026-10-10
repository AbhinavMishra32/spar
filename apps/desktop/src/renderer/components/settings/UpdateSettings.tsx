import { useEffect, useState } from "react";
import { IconArrowInbox, IconArrowRotateRightLeft, IconCheckmark1, IconLoader } from "central-icons";
import type { SparApi, UpdateState } from "../../../shared/api";
import { Button } from "@/components/ui/button";
import { message, releaseVersion } from "@/lib/format";
import { SettingsRow } from "./layout";

const STATUS: Record<UpdateState["status"], string> = {
  idle: "Ready to check",
  checking: "Checking for updates…",
  available: "Update available",
  downloading: "Downloading update…",
  installing: "Installing update…",
  current: "Spar is up to date",
  error: "Update didn’t finish",
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
    ? `Spar ${releaseVersion(state.version)} is available. Spar saves your work and restarts to install it.`
    : state?.status === "downloading"
      ? `${Math.round(state.percent ?? 0)}% downloaded.`
      : state?.status === "installing"
        ? "Saving your work, then restarting."
        : state?.status === "error"
          ? state.message
          : state?.status === "unsupported"
            ? state.message
            : `You have ${state?.currentVersion ? releaseVersion(state.currentVersion) : "the latest version"}. Spar checks when it opens and every few hours.`;

  return (
    <SettingsRow className="gap-4">
      <div className="grid size-9 shrink-0 place-items-center rounded-lg bg-accent text-foreground">
        {busy ? <IconLoader className="size-4 animate-spin" /> : state?.status === "current" ? <IconCheckmark1 className="size-4 text-success" /> : <IconArrowRotateRightLeft className="size-4" />}
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-content font-medium">{state ? STATUS[state.status] : "Automatic updates"}</p>
        <p className="mt-0.5 text-ui leading-relaxed text-muted-foreground">{failure || detail}</p>
      </div>
      {state?.status === "available" ? (
        <Button disabled={!api} onClick={download} size="sm"><IconArrowInbox />Update</Button>
      ) : (
        <Button disabled={!api || busy || state?.status === "unsupported"} onClick={check} size="sm" variant="secondary"><IconArrowRotateRightLeft />Check now</Button>
      )}
    </SettingsRow>
  );
}
