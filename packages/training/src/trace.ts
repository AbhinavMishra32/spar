import type { AttemptEvent } from "@pracai/domain";
export function buildAttemptTrace(events: AttemptEvent[]): string {
  const ordered=[...events].sort((a,b)=>a.sequence-b.sequence); const lines=["# Attempt Trace","",`Generated from ${ordered.length} immutable events.`,""];
  for(const event of ordered){const time=new Date(event.occurredAt).toLocaleTimeString("en-US",{hour:"2-digit",minute:"2-digit"});lines.push(`## ${label(event.type)} · ${time}`,"",describe(event),"");}
  return lines.join("\n").trim()+"\n";
}
function label(type:string){return type.split("_").map(v=>v[0]?.toUpperCase()+v.slice(1)).join(" ")}
function describe(event:AttemptEvent){if(event.type==="learner_remark")return `> ${String(event.payload.body??"")}`;if(event.type==="file_changed")return `Changed \`${String(event.payload.path??"unknown")}\` (${String(event.payload.additions??0)} additions, ${String(event.payload.deletions??0)} deletions).`;if(event.type==="test_run")return `Test run ${event.payload.passed?"passed":"failed"}: ${String(event.payload.summary??"")}`;if(event.type==="hint_requested")return `Requested hint level ${String(event.payload.level??1)}.`;return String(event.payload.summary??`Recorded by ${event.source}.`);}

