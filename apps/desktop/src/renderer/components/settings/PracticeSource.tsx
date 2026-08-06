import { useCallback, useEffect, useState } from "react";
import { Ellipsis, Gavel, Laptop, Loader2, RotateCw, Trash2 } from "lucide-react";
import type { PracticeInventory, SourceJudgePreference, SparApi } from "../../../shared/api";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Segmented } from "@/components/ui/segmented";
import { SparDots } from "@/components/common/SparDots";
import { message } from "@/lib/format";
import { cn } from "@/lib/utils";
import { SourceGlyph } from "../common/SourceGlyph";

/**
 * The practice source, in Settings.
 *
 * Built to the same row idiom as the provider list — mark, name, one muted line,
 * one trailing control — because it sits in the same card stack and a block that
 * invents its own layout reads as a different app. The things worth saying that
 * do not fit in one line become their own rows rather than a paragraph or a
 * nested card: this page is a stack of one-line facts, and the LeetCode section
 * has no licence to be an essay in the middle of it.
 *
 * What survived the trim is the one sentence the learner is owed before they
 * hand an app a session to their account, and it is shown while disconnected —
 * which is the only moment it can still inform a decision.
 */
export function PracticeSourceGroup({ api }: { api: SparApi | undefined }) {
  const [inventory, setInventory] = useState<PracticeInventory | null>(null);
  const [busy, setBusy] = useState<"connect" | "disconnect" | "region" | "judge" | null>(null);
  const [note, setNote] = useState<{ tone: "muted" | "error"; text: string } | null>(null);

  const read = useCallback(async () => {
    if (!api) return;
    setInventory(await api.practiceSource());
  }, [api]);

  useEffect(() => { void read().catch((cause) => setNote({ tone: "error", text: message(cause) })); }, [read]);
  /* The sign-in happens in a window the main process owns, so this row learns it
     finished by being told rather than by waiting on the call. */
  useEffect(() => api?.onPracticeSourceEvent((event) => {
    setNote(event.state === "connected" ? null : { tone: "muted", text: event.message });
    void read().catch(() => undefined);
  }), [api, read]);

  const act = async (kind: NonNullable<typeof busy>, run: () => Promise<void>) => {
    setBusy(kind);
    setNote(null);
    try { await run(); await read(); }
    catch (cause) { setNote({ tone: "error", text: message(cause) }); }
    finally { setBusy(null); }
  };

  const connect = () => act("connect", async () => {
    const result = await api?.connectPracticeSource();
    if (result?.status === "failed") setNote({ tone: "error", text: result.message });
  });

  if (!inventory) {
    return (
      <Row>
        <SparDots className="text-muted-foreground" pattern="pulse" size={16} />
        <span className="text-ui text-muted-foreground">Reading the practice source…</span>
      </Row>
    );
  }

  const { account, name, state } = inventory;
  const connected = state === "connected";

  return (
    <>
      <Row>
        <span className="grid size-6 shrink-0 place-items-center text-foreground/85">
          <SourceGlyph className="size-[1.15rem]" source={inventory.source} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <p className="truncate text-content font-medium">{name}</p>
            {connected && <span className="shrink-0 rounded-full bg-success/12 px-1.5 py-px text-ui-sm font-medium text-success">Connected</span>}
            {state === "expired" && <span className="shrink-0 rounded-full bg-destructive/12 px-1.5 py-px text-ui-sm font-medium text-destructive">Sign in again</span>}
          </div>
          <p className="truncate text-ui text-muted-foreground">
            {connected && account
              ? `${account.username} · solves here count on your account`
              : state === "expired"
                ? "The stored session lapsed, so nothing about you is readable until you reconnect."
                : "Real problems, judged by LeetCode. You sign in on their page — Spar never sees your password."}
          </p>
        </div>

        {connected
          ? (
            <DropdownMenu>
              <DropdownMenuTrigger
                aria-label={`${name} options`}
                className="grid size-7 shrink-0 place-items-center rounded-[var(--radius-md)] text-muted-foreground transition-colors outline-none hover:bg-accent hover:text-foreground aria-expanded:bg-accent aria-expanded:text-foreground"
              >
                {busy ? <Loader2 className="size-4 animate-spin" /> : <Ellipsis className="size-4" />}
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onSelect={() => void connect()}><RotateCw />Reconnect account</DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem onSelect={() => void act("disconnect", async () => api?.disconnectPracticeSource())} variant="destructive">
                  <Trash2 />Disconnect
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          )
          : (
            <Button disabled={busy !== null} onClick={() => void connect()} size="sm">
              {busy === "connect" ? <Loader2 className="size-3.5 animate-spin" /> : "Connect"}
            </Button>
          )}
      </Row>

      {note && (
        <Row>
          <p className={cn("text-ui", note.tone === "error" ? "text-destructive" : "text-muted-foreground")}>{note.text}</p>
        </Row>
      )}

      {/* Their record at the source, as one line. Labelled for what it is: the
          ledger decides what they can do, and this says what they have met. */}
      {connected && account && (
        <Row className="gap-4">
          <div className="min-w-0 flex-1">
            <p className="text-content font-medium">Your record there</p>
            <p className="mt-0.5 truncate text-ui text-muted-foreground">
              {`Easy ${account.solved.easy} · Medium ${account.solved.medium} · Hard ${account.solved.hard}`}
              {topSkills(account) ? ` · most solved ${topSkills(account)}` : ""}
            </p>
          </div>
          <span className="shrink-0 text-content tabular-nums text-muted-foreground">
            <span className="font-medium text-foreground">{account.solved.total}</span> solved
          </span>
        </Row>
      )}

      <Row className="gap-4">
        <div className="min-w-0 flex-1">
          <p className="text-content font-medium">Who judges your solutions</p>
          <p className="mt-0.5 text-ui text-muted-foreground">
            {inventory.judgesSubmissions
              ? `Submitting runs every hidden case ${name} has and records the result on your account.`
              : connected
                ? "Your code stays on this machine, checked against each problem's published examples."
                : `Connect ${name} to have it judge submissions. Until then Spar grades locally.`}
          </p>
        </div>
        <Segmented
          ariaLabel="Who judges your solutions"
          disabled={busy !== null || !connected}
          onChange={(value) => void act("judge", async () => api?.setPracticeJudge(value as SourceJudgePreference))}
          options={[{ value: "source", label: name, icon: Gavel }, { value: "local", label: "This Mac", icon: Laptop }]}
          value={inventory.judgePreference}
        />
      </Row>

      {inventory.regions.length > 1 && (
        <Row className="gap-4">
          <div className="min-w-0 flex-1">
            <p className="text-content font-medium">Which {name}</p>
            <p className="mt-0.5 text-ui text-muted-foreground">Separate accounts and separate problem numbering. Switching disconnects the other.</p>
          </div>
          <Segmented
            ariaLabel={`Which ${name}`}
            disabled={busy !== null}
            onChange={(value) => void act("region", async () => api?.setPracticeRegion(value as "global" | "cn"))}
            options={inventory.regions.map((region) => ({ value: region.id, label: region.label }))}
            value={inventory.region}
          />
        </Row>
      )}
    </>
  );
}

/** The three tags they have solved most under, or nothing. Three because the
 *  line has to stay a line. */
function topSkills(account: NonNullable<PracticeInventory["account"]>): string {
  return account.skills
    .filter((skill) => skill.solved > 0)
    .sort((left, right) => right.solved - left.solved)
    .slice(0, 3)
    .map((skill) => skill.name)
    .join(", ");
}

/** The Settings page's own row metrics. Duplicated rather than exported from the
 *  page, because the page importing this and this importing the page is a cycle
 *  nobody needs. */
function Row({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={cn("flex min-h-[3.375rem] items-center gap-3 px-3.5 py-2", className)}>{children}</div>;
}
