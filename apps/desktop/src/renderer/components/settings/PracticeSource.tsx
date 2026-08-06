import { useCallback, useEffect, useState } from "react";
import { CheckCircle2, ExternalLink, Gavel, Laptop, Loader2, TriangleAlert } from "lucide-react";
import type { PracticeInventory, SourceJudgePreference, SparApi } from "../../../shared/api";
import { Button } from "@/components/ui/button";
import { Segmented } from "@/components/ui/segmented";
import { message } from "@/lib/format";
import { credentialStore } from "@/lib/platform";
import { cn } from "@/lib/utils";
import { SourceGlyph } from "../common/SourceGlyph";

/**
 * The practice source, in Settings.
 *
 * Four things the learner needs and one they are owed. They need to know whether
 * it is connected, as whom, what Spar can therefore do, and how to change any of
 * it. What they are owed is the third row: an app asking for a session cookie to
 * somebody's LeetCode account has to say, before they click, exactly what it will
 * hold and what it will do with it.
 *
 * The account block is deliberately more than a username. Solve counts per
 * difficulty are the source's own record of what this learner has been exposed
 * to, and showing them here is what makes "Spar knows about my LeetCode" true
 * rather than a claim.
 */
export function PracticeSourceGroup({ api }: { api: SparApi | undefined }) {
  const [inventory, setInventory] = useState<PracticeInventory | null>(null);
  const [busy, setBusy] = useState<"connect" | "disconnect" | "region" | "judge" | null>(null);
  const [failure, setFailure] = useState("");
  const [progress, setProgress] = useState("");

  const read = useCallback(async () => {
    if (!api) return;
    setInventory(await api.practiceSource());
  }, [api]);

  useEffect(() => { void read().catch((cause) => setFailure(message(cause))); }, [read]);
  /* The sign-in happens in a window the main process owns, so the only way this
     row learns it finished is by being told. */
  useEffect(() => api?.onPracticeSourceEvent((event) => {
    setProgress(event.message);
    void read().catch(() => undefined);
  }), [api, read]);

  const act = async (kind: NonNullable<typeof busy>, run: () => Promise<void>) => {
    setBusy(kind);
    setFailure("");
    try { await run(); await read(); }
    catch (cause) { setFailure(message(cause)); }
    finally { setBusy(null); setProgress(""); }
  };

  const connect = () => act("connect", async () => {
    const result = await api?.connectPracticeSource();
    if (result?.status === "failed") setFailure(result.message);
  });

  if (!inventory) {
    return (
      <Row>
        <span className="text-ui text-muted-foreground">Reading the practice source…</span>
      </Row>
    );
  }

  const { state, account, name } = { ...inventory, name: inventory.name };
  const connected = state === "connected";

  return (
    <>
      <Row className="flex-col items-stretch gap-3 py-3">
        <div className="flex min-w-0 items-center gap-3">
          <span className="grid size-6 shrink-0 place-items-center text-foreground/85">
            <SourceGlyph className="size-[1.15rem]" source={inventory.source} />
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <p className="text-content font-medium">{name}</p>
              <StateChip state={state} />
            </div>
            <p className="mt-0.5 text-ui text-muted-foreground">
              {connected && account
                ? `Connected as ${account.username}${account.premium ? " · Premium" : ""}. Solves you make here count on your account.`
                : state === "expired"
                  ? `${name} stopped accepting the stored session. Reconnect to keep judging submissions there.`
                  : inventory.description}
            </p>
          </div>
          {connected
            ? (
              <Button disabled={busy !== null} onClick={() => void act("disconnect", async () => api?.disconnectPracticeSource())} size="sm" variant="ghost">
                {busy === "disconnect" ? <Loader2 className="size-3.5 animate-spin" /> : "Disconnect"}
              </Button>
            )
            : null}
          <Button disabled={busy !== null} onClick={() => void connect()} size="sm" variant={connected ? "ghost" : "default"}>
            {busy === "connect" ? <Loader2 className="size-3.5 animate-spin" /> : connected ? "Reconnect" : `Connect ${name}`}
          </Button>
        </div>

        {(progress || failure) && (
          <p className={cn("pl-9 text-ui", failure ? "text-destructive" : "text-muted-foreground")}>{failure || progress}</p>
        )}

        {/* Said before the button is pressed, not after. */}
        <p className="pl-9 text-ui text-muted-foreground">
          {inventory.authNote.replace("your system keychain", credentialStore)}
        </p>

        {connected && account && <AccountBlock account={account} name={name} />}
      </Row>

      <Row className="gap-4 py-2.5">
        <div className="min-w-0 flex-1">
          <p className="text-content font-medium">Who judges your solutions</p>
          <p className="mt-0.5 text-ui text-muted-foreground">
            {inventory.judgesSubmissions
              ? `Submitting sends your solution to ${name}, which runs every hidden case it has and records the result on your account.`
              : connected
                ? `Your code stays on this machine. Spar grades against the examples published with each problem, which is weaker than ${name}'s own judge.`
                : `Connect ${name} to have it judge submissions. Until then Spar grades locally against each problem's published examples.`}
          </p>
        </div>
        <Segmented
          ariaLabel="Who judges your solutions"
          disabled={busy !== null || !connected}
          onChange={(value) => void act("judge", async () => api?.setPracticeJudge(value as SourceJudgePreference))}
          options={[
            { value: "source", label: name, icon: Gavel },
            { value: "local", label: "This Mac", icon: Laptop },
          ]}
          value={inventory.judgePreference}
        />
      </Row>

      {inventory.regions.length > 1 && (
        <Row className="gap-4 py-2.5">
          <div className="min-w-0 flex-1">
            <p className="text-content font-medium">Which {name}</p>
            <p className="mt-0.5 text-ui text-muted-foreground">
              Separate services with separate accounts and separate problem numbering. Switching disconnects the other one.
            </p>
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

/** The source's own record of this learner. Weak evidence beside Spar's ledger,
 *  and labelled as exposure rather than as ability for exactly that reason. */
function AccountBlock({ account, name }: { account: NonNullable<PracticeInventory["account"]>; name: string }) {
  const bands = [
    { label: "Easy", solved: account.solved.easy, total: account.available.easy, tone: "text-[var(--success)]" },
    { label: "Medium", solved: account.solved.medium, total: account.available.medium, tone: "text-[var(--warning)]" },
    { label: "Hard", solved: account.solved.hard, total: account.available.hard, tone: "text-destructive" },
  ];
  const top = account.skills.filter((skill) => skill.solved > 0).sort((left, right) => right.solved - left.solved).slice(0, 5);
  return (
    <div className="ml-9 rounded-[var(--radius-lg)] border border-border bg-background/40 px-3 py-2.5">
      <div className="flex flex-wrap items-baseline gap-x-5 gap-y-1.5">
        <span className="text-ui text-muted-foreground">
          <span className="text-content font-medium text-foreground">{account.solved.total}</span> solved on {name}
        </span>
        {bands.map((band) => (
          <span className="text-ui text-muted-foreground" key={band.label}>
            <span className={cn("font-medium", band.tone)}>{band.label}</span> {band.solved}
            {band.total ? <span className="text-muted-foreground/70">/{band.total}</span> : null}
          </span>
        ))}
        {account.streak > 0 && <span className="text-ui text-muted-foreground">{account.streak}-day streak</span>}
      </div>
      {top.length > 0 && (
        <p className="mt-2 text-ui text-muted-foreground">
          Most solved: {top.map((skill) => `${skill.name} (${skill.solved})`).join(" · ")}. Spar reads these as what you have been exposed to, not as what you can do — its own ledger decides that.
        </p>
      )}
    </div>
  );
}

function StateChip({ state }: { state: PracticeInventory["state"] }) {
  if (state === "connected") {
    return (
      <span className="inline-flex items-center gap-1 rounded-md bg-[var(--success)]/12 px-1.5 py-0.5 text-ui-sm font-medium text-[var(--success)]">
        <CheckCircle2 className="size-3" />Connected
      </span>
    );
  }
  if (state === "expired") {
    return (
      <span className="inline-flex items-center gap-1 rounded-md bg-[var(--warning)]/14 px-1.5 py-0.5 text-ui-sm font-medium text-[var(--warning)]">
        <TriangleAlert className="size-3" />Session expired
      </span>
    );
  }
  return <span className="rounded-md bg-muted px-1.5 py-0.5 text-ui-sm font-medium text-muted-foreground">Not connected</span>;
}

/** Matches the Settings page's own row metrics. Duplicated rather than exported
 *  from the page, because the page importing this and this importing the page is
 *  a cycle nobody needs. */
function Row({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={cn("flex min-h-[3.375rem] items-center gap-3 px-3.5 py-2", className)}>{children}</div>;
}

/** A link to the source's own page for the learner who wants to look. Exported
 *  so the page can put it beside the group heading rather than inside a row. */
export function SourceHomeLink({ api, url, label }: { api: SparApi | undefined; url: string; label: string }) {
  return (
    <button className="inline-flex items-center gap-1 text-ui text-muted-foreground hover:text-foreground" onClick={() => void api?.openExternal(url)} type="button">
      <ExternalLink className="size-3" />{label}
    </button>
  );
}
