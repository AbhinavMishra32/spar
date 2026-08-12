import { useCallback, useEffect, useRef, useState } from "react";
import { CircleAlert, Ellipsis, Gavel, Laptop, Loader2, RotateCw, ShieldCheck, Trash2 } from "lucide-react";
import type { PracticeInventory, SourceJudgePreference, SparApi } from "../../../shared/api";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Meter, MeterKey, type MeterBand } from "@/components/ui/meter";
import { Segmented } from "@/components/ui/segmented";
import { SparDots } from "@/components/common/SparDots";
import { message } from "@/lib/format";
import { cn } from "@/lib/utils";
import { SourceGlyph } from "../common/SourceGlyph";

type SourceNote = { tone: "muted" | "error"; text: string };

/**
 * Settings is the renderer for practice-source state, not its owner. Connection
 * sessions stay in the main process and every mutation below goes back through
 * the typed preload API. Keeping that boundary lets this component reorganise
 * the information without creating a second, UI-only idea of what is connected
 * or where a submission will be judged.
 *
 * Each provider is a small stack of the same rows Settings uses everywhere else:
 * identity first, then only the facts and controls that are live for that state.
 * It deliberately does not introduce a nested dashboard surface — this belongs
 * to Settings, so its hierarchy comes from hairlines, type and alignment rather
 * than from a card inside the page's existing card.
 */
export function PracticeSourceGroup({ api }: { api: SparApi | undefined }) {
  const [inventory, setInventory] = useState<PracticeInventory[] | null>(null);
  const [busy, setBusy] = useState<{ source: PracticeInventory["source"]; action: string } | null>(null);
  const [notes, setNotes] = useState<Partial<Record<PracticeInventory["source"], SourceNote>>>({});
  const readRevision = useRef(0);

  const read = useCallback(async () => {
    if (!api) return;
    const revision = ++readRevision.current;
    const next = await api.practiceSources();
    /* Events and mutations can overlap. Only the newest read may paint the UI;
       otherwise an older "connected" response can arrive after "expired" and
       visually undo the host's newer state. */
    if (revision === readRevision.current) setInventory(next);
  }, [api]);

  useEffect(() => { void read().catch((cause) => setNotes({ leetcode: { tone: "error", text: message(cause) } })); }, [read]);
  /* Sign-in is a main-process-owned window, so completion arrives as an event
     rather than as renderer state leaking across the credential boundary. */
  useEffect(() => api?.onPracticeSourceEvent((event) => {
    setNotes((current) => ({ ...current, [event.source]: event.state === "connected" ? undefined : { tone: "muted", text: event.message } }));
    void read().catch(() => undefined);
  }), [api, read]);

  const act = async (source: PracticeInventory["source"], action: string, run: () => Promise<void>) => {
    const operation = { source, action };
    setBusy(operation);
    setNotes((current) => ({ ...current, [source]: undefined }));
    try { await run(); await read(); }
    catch (cause) { setNotes((current) => ({ ...current, [source]: { tone: "error", text: message(cause) } })); }
    finally { setBusy((current) => current === operation ? null : current); }
  };

  const connect = (source: PracticeInventory["source"]) => act(source, "connect", async () => {
    const result = await api?.connectPracticeSource(source);
    if (result?.status === "failed") setNotes((current) => ({ ...current, [source]: { tone: "error", text: result.message } }));
  });

  if (!inventory) {
    return (
      <Row>
        <SparDots className="text-muted-foreground" pattern="pulse" size={16} />
        <span className="text-ui text-muted-foreground">Reading practice sources…</span>
      </Row>
    );
  }

  return (
    <>
      {inventory.map((item) => (
        <SourceCard
          api={api}
          busy={busy}
          connect={connect}
          item={item}
          key={item.source}
          note={notes[item.source]}
          run={act}
        />
      ))}
    </>
  );
}

function SourceCard({
  api,
  busy,
  connect,
  item,
  note,
  run,
}: {
  api: SparApi | undefined;
  busy: { source: PracticeInventory["source"]; action: string } | null;
  connect(source: PracticeInventory["source"]): void;
  item: PracticeInventory;
  note: SourceNote | undefined;
  run(source: PracticeInventory["source"], action: string, task: () => Promise<void>): Promise<void>;
}) {
  const { account, name, source, state } = item;
  const connected = state === "connected";
  const sourceBusy = busy?.source === source;
  const progress = note?.tone === "muted" ? note.text : undefined;
  const failure = note?.tone === "error" ? note.text : item.problem;
  const summary = connected && account
    ? `${account.username} · ${account.solved.total.toLocaleString()} solved`
    : sourceBusy && busy?.action === "connect" && progress
      ? progress
      : state === "expired"
        ? "Sign in again to restore history and submissions."
        : progress ?? item.description;

  return (
    <article className="divide-y divide-border">
      <Row className="gap-3 py-2.5">
        <span className="grid size-6 shrink-0 place-items-center text-foreground/85">
          <SourceGlyph className="size-[1.15rem]" source={source} />
        </span>

        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-center gap-1.5">
            <h3 className="truncate text-content font-medium">{name}</h3>
            <Status state={state} />
          </div>
          <p className="mt-0.5 truncate text-ui text-muted-foreground">{summary}</p>
        </div>

        {connected
          ? (
            <DropdownMenu>
              <DropdownMenuTrigger
                aria-label={`${name} options`}
                className="grid size-7 shrink-0 place-items-center rounded-[var(--radius-md)] text-muted-foreground transition-colors outline-none hover:bg-accent hover:text-foreground aria-expanded:bg-accent aria-expanded:text-foreground"
              >
                {sourceBusy ? <Loader2 className="size-4 animate-spin" /> : <Ellipsis className="size-4" />}
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onSelect={() => connect(source)}><RotateCw />Reconnect account</DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem onSelect={() => void run(source, "disconnect", async () => api?.disconnectPracticeSource(source))} variant="destructive">
                  <Trash2 />Disconnect
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          )
          : (
            <div className="flex shrink-0 items-center gap-2">
              {item.regions.length > 1 && (
                <Segmented
                  ariaLabel={`${name} site`}
                  className="w-[10.5rem]"
                  disabled={sourceBusy && busy?.action !== "connect"}
                  onChange={(value) => void run(source, "region", async () => api?.setPracticeRegion(source, value as "global" | "cn"))}
                  options={item.regions.map((region) => ({ value: region.id, label: region.label }))}
                  value={item.region}
                />
              )}
              <Button disabled={sourceBusy} onClick={() => connect(source)} size="sm">
                {busy?.source === source && busy.action === "connect" ? <Loader2 className="size-3.5 animate-spin" /> : state === "expired" ? "Reconnect" : "Connect"}
              </Button>
            </div>
          )}
      </Row>

      {failure && (
        <Row className="min-h-0 items-start gap-2 py-2.5 text-destructive" role="alert">
          <CircleAlert className="mt-0.5 size-3.5 shrink-0" />
          <p className="text-ui leading-[1.5]">{failure}</p>
        </Row>
      )}

      {connected && account
        ? (
          <ConnectedSource account={account} api={api} item={item} run={run} sourceBusy={sourceBusy} />
        )
        : !failure && !progress && state !== "expired" && (
          <Row className="min-h-0 items-start gap-2 py-2.5">
            <ShieldCheck className="mt-0.5 size-3.5 shrink-0 text-muted-foreground/70" />
            <p className="text-ui leading-[1.5] text-muted-foreground">{item.authNote}</p>
          </Row>
        )}
    </article>
  );
}

function ConnectedSource({
  account,
  api,
  item,
  run,
  sourceBusy,
}: {
  account: NonNullable<PracticeInventory["account"]>;
  api: SparApi | undefined;
  item: PracticeInventory;
  run(source: PracticeInventory["source"], action: string, task: () => Promise<void>): Promise<void>;
  sourceBusy: boolean;
}) {
  const { name, source } = item;
  const bands = solvedBands(account);
  const skills = topSkills(account);

  return (
    <>
      <Row className="gap-4 py-2.5" role="region" aria-label={`${name} activity`}>
        <div className="min-w-0 flex-1">
          <p className="text-content font-medium">Activity</p>
          <div className="mt-0.5 flex min-w-0 flex-wrap items-center gap-x-3 gap-y-0.5">
            {bands.filter((band) => band.value > 0).map((band) => <MeterKey band={band} className="text-ui" key={band.key} />)}
            {account.streak > 0 && <span className="text-ui text-muted-foreground">{account.streak}-day streak</span>}
            {skills && <span className="truncate text-ui text-muted-foreground">Most in {skills}</span>}
          </div>
        </div>
        <div className="w-[13.5rem] shrink-0">
          <div className="mb-1.5 flex items-baseline justify-between gap-3 text-ui-sm tabular-nums text-muted-foreground">
            <span><span className="font-medium text-foreground/85">{account.solved.total.toLocaleString()}</span> solved</span>
            {account.available.total > 0 && <span>of {account.available.total.toLocaleString()}</span>}
          </div>
          <Meter bands={bands} height="0.3125rem" total={account.available.total} />
        </div>
      </Row>

      <Row className="gap-4 py-2.5" role="region" aria-label={`${name} judging`}>
        <div className="min-w-0 flex-1">
          <p className="text-content font-medium">Submission judge</p>
          <p className="mt-0.5 text-ui text-muted-foreground">{judgeDetail(item)}</p>
        </div>
        <Segmented
          ariaLabel={`${name} submission judge`}
          className="w-[18rem]"
          disabled={sourceBusy}
          onChange={(value) => void run(source, "judge", async () => api?.setPracticeJudge(source, value as SourceJudgePreference))}
          options={[{ value: "source", label: name, icon: Gavel }, { value: "local", label: "This Mac", icon: Laptop }]}
          value={item.judgePreference}
        />
      </Row>

      {item.regions.length > 1 && (
        <Row className="gap-4 py-2.5" role="region" aria-label={`${name} site`}>
          <div className="min-w-0 flex-1">
            <p className="text-content font-medium">Problem catalogue</p>
            <p className="mt-0.5 text-ui text-muted-foreground">Switching sites also switches accounts and problem numbers.</p>
          </div>
          <Segmented
            ariaLabel={`${name} site`}
            className="w-[18rem]"
            disabled={sourceBusy}
            onChange={(value) => void run(source, "region", async () => api?.setPracticeRegion(source, value as "global" | "cn"))}
            options={item.regions.map((region) => ({ value: region.id, label: region.label }))}
            value={item.region}
          />
        </Row>
      )}
    </>
  );
}

function Status({ state }: { state: PracticeInventory["state"] }) {
  const label = state === "connected" ? "Connected" : state === "expired" ? "Session expired" : "Not connected";
  return (
    <span className={cn(
      "inline-flex shrink-0 items-center gap-1 text-ui-sm font-medium",
      state === "connected" ? "text-success" : state === "expired" ? "text-destructive" : "text-muted-foreground",
    )}>
      <span className="size-1.5 rounded-full bg-current" />
      {label}
    </span>
  );
}

function judgeDetail(item: PracticeInventory): string {
  if (item.judgePreference === "local") return "Code stays on this Mac and published examples decide the result.";
  return item.capabilities.scratchRun
    ? `Run checks examples at ${item.name}; Submit records the official verdict.`
    : `Run checks examples on this Mac; Submit records ${item.name}' official verdict.`;
}

/** The solve counts as bands in the source's difficulty tiers. The Meter gets
 *  the catalogue total separately: without it, 93 solves incorrectly render as
 *  100% progress because the component can only normalise against 93. */
function solvedBands(account: NonNullable<PracticeInventory["account"]>): MeterBand[] {
  return [
    { key: "easy", value: account.solved.easy, className: "bg-success", label: "Easy" },
    { key: "medium", value: account.solved.medium, className: "bg-warning", label: "Medium" },
    { key: "hard", value: account.solved.hard, className: "bg-destructive", label: "Hard" },
  ];
}

function topSkills(account: NonNullable<PracticeInventory["account"]>): string {
  return account.skills
    .filter((skill) => skill.solved > 0)
    .sort((left, right) => right.solved - left.solved)
    .slice(0, 3)
    .map((skill) => skill.name)
    .join(", ");
}

function Row({ className, ...props }: React.ComponentProps<"div">) {
  return <div className={cn("flex min-h-[3.375rem] items-center gap-3 px-3.5 py-2", className)} {...props} />;
}
