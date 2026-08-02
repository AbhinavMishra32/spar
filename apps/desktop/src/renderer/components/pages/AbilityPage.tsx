import {BookOpen,Layers3} from "lucide-react";
import type {AbilityHistorySummary} from "@spar/domain";
import {relativeTime} from "@/lib/format";
import {EmptyState} from "../common/EmptyState";

/** The ledger's four states, said the way Spar talks about them. The raw status
 *  stays on the title attribute — it is what the agent writes and reads. */
const STATUS_PHRASE: Record<AbilityHistorySummary["status"], string> = {
  uncertain: "Needs a first round",
  developing: "Needs another round",
  independent: "Ready to move on",
  stale: "Worth another round",
};

export function AbilityPage({abilities}:{abilities:AbilityHistorySummary[]}){return <div className="app-scroll h-full overflow-y-auto"><div className="mx-auto w-full max-w-[52rem] px-6 pb-16 pt-8"><h1 className="text-[1.35rem] font-semibold tracking-[-0.03em]">Abilities</h1><p className="mt-1 text-content text-muted-foreground">A versioned ledger Spar can read and update. Introduced concepts begin uncertain; attempt evidence changes confidence.</p><div className="mt-5 flex flex-col gap-2">{abilities.length?abilities.map((ability)=><article key={ability.id} className="rounded-xl border border-border bg-card px-4 py-3 shadow-[var(--app-shadow-soft)]"><div className="flex items-start gap-3"><span className="grid size-8 shrink-0 place-items-center rounded-lg bg-[var(--color-background-elevated-secondary)] text-muted-foreground"><BookOpen className="size-4"/></span><div className="min-w-0 flex-1"><div className="flex items-center gap-2"><h2 className="truncate text-content font-semibold">{ability.title}</h2><span className="rounded-md border border-border px-1.5 py-0.5 text-ui-sm text-muted-foreground" title={ability.status}>{STATUS_PHRASE[ability.status]}</span></div><p className="mt-1 line-clamp-3 whitespace-pre-line text-ui leading-[1.6] text-muted-foreground">{ability.markdown.replace(/^#+\s*/gm,"").trim()}</p><p className="mt-2 text-ui-sm text-muted-foreground/70">Version {ability.version} · {ability.evidenceCount} evidence link{ability.evidenceCount===1?"":"s"} · updated {relativeTime(ability.updatedAt)}</p></div></div></article>):<EmptyState icon={Layers3} title="No abilities yet" description="Spar can introduce an ability from your goal, then version it as deterministic attempts provide evidence."/>}</div></div></div>}
