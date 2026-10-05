import { IconArrowRight, IconCheckmark1, IconCrossMedium, IconLoader } from "central-icons";
import { Fragment } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { Inline } from "../agent/Markdown";
import type { ComplexityVerdict } from "../../../shared/api";

export type ComplexityCheckpointState = {
  phase: "answering" | "reviewing" | "reviewed" | "acknowledging";
  time: string;
  space: string;
  review: string;
  /** Which halves were right, when the reviewer said so in a form that can be
   *  read. Absent for a review that came back as prose, and for every review
   *  recorded before the checkpoint returned one — the card then reports without
   *  marking rather than ticking on faith. */
  verdict?: ComplexityVerdict | null;
};

type Growth = "constant" | "logarithmic" | "linear" | "linearithmic" | "quadratic" | "cubic" | "exponential" | "factorial" | "unknown";

export function growthFromComplexity(value: string): Growth {
  const text=value.toLowerCase().replaceAll(" ","").replaceAll("·","*");
  if(!text)return "unknown";
  if(text.includes("!")||text.includes("factorial"))return "factorial";
  if(/(?:2|[a-z])\^[a-z]/.test(text)||text.includes("exponential"))return "exponential";
  if(/(?:n|v|m|k)\^?3|cubic/.test(text))return "cubic";
  if(/(?:n|v|m|k)(?:\^2|²)|quadratic/.test(text))return "quadratic";
  if(/(?:n|v|m|k)(?:\*?)log|log(?:n|v|m|k)(?:\*?)(?:n|v|m|k)|linearithmic/.test(text))return "linearithmic";
  if(text.includes("log")||text.includes("logarithmic"))return "logarithmic";
  if(/o\((?:1|c)\)/.test(text)||text.includes("constant"))return "constant";
  if(/[nvmk]|linear/.test(text))return "linear";
  return "unknown";
}

const LABEL:Record<Growth,string>={constant:"constant",logarithmic:"logarithmic",linear:"linear",linearithmic:"n log n",quadratic:"quadratic",cubic:"cubic",exponential:"exponential",factorial:"factorial",unknown:"type a bound"};

function curve(growth:Growth){
  const points=Array.from({length:18},(_,index)=>index+1);
  const factorial=(n:number)=>{let value=1;for(let i=2;i<=n;i+=1)value*=i;return value;};
  const value=(n:number)=>growth==="constant"?1:growth==="logarithmic"?Math.log2(n+1):growth==="linear"||growth==="unknown"?n:growth==="linearithmic"?n*Math.log2(n+1):growth==="quadratic"?n*n:growth==="cubic"?n*n*n:growth==="exponential"?2**(n/2):factorial(Math.ceil(n/2));
  const values=points.map(value);const max=Math.max(...values);
  return values.map((amount,index)=>`${index?"L":"M"} ${8+index*(104/(values.length-1))} ${growth==="constant"?28:48-(amount/max)*36}`).join(" ");
}

/** A bound as the reviewer wrote it, split into the bound and its gloss. Reviews
 *  recorded before the breakdown existed carry both in one string —
 *  "O(n) auxiliary space, where n = len(score)" — which is unreadable as a
 *  headline. */
export function splitBound(value:string):{bound:string;where:string}{
  const [head="",...rest]=value.split(/,?\s+where\s+/i);
  return {bound:head.replace(/\s+(?:auxiliary|extra|total)?\s*(?:space|time)$/i,"").trim(),where:rest.join(" where ").trim()};
}

function MiniGraph({value,label,claim,matched}: {value:string;label:string;claim?:string;matched?:boolean | undefined}){
  const growth=growthFromComplexity(value);
  const claimed=growthFromComplexity(claim ?? value);
  const comparing=matched===false;
  const reducedMotion=useReducedMotion();
  const transition={duration:reducedMotion ? 0 : 0.6,ease:[0.22,0.61,0.36,1] as const};
  /* The well is a recess, not a hole. `--color-background-surface-under` is mixed
     22% toward pure black, which is right under a code buffer filling a pane and
     is not right for two small boxes sitting inside a card: at this size the
     black reads as a gap punched through the window rather than as a step down
     from the surface. So the dark theme lifts it back toward the foreground just
     far enough to stay below the card and stop being black. Local rather than a
     change to the token, because every other sunken surface in the app is large
     enough for the deeper value to read correctly. */
  return <div title="Illustrative growth, normalized" className={cn("rounded-[var(--radius-lg)] border border-[var(--glass-hairline)] bg-[var(--color-background-surface-under)] px-2.5 pb-2 pt-2 transition-colors duration-500 dark:bg-[color-mix(in_oklab,var(--foreground)_4%,var(--color-background-surface-under))]",matched===true&&"border-[var(--success)]/30",matched===false&&"border-destructive/30")}>
    <div className="mb-1 flex items-center justify-between text-ui-sm"><Field label={label} matched={matched}/><span className="text-muted-foreground">{LABEL[growth]}</span></div>
    <svg aria-label={comparing ? `${label}: your answer ${claim}; reviewed bound ${value}. Illustrative growth curves.` : `${label} ${LABEL[growth]} growth preview`} className="h-12 w-full overflow-visible" role="img" viewBox="0 0 120 56">
      <path d="M 8 48 H 114 M 8 48 V 8" fill="none" stroke="currentColor" className="text-border" strokeWidth="1" />
      <motion.path initial={false} animate={{d:curve(growth),opacity:growth==="unknown"?0.25:1}} transition={transition} fill="none" stroke="currentColor" className={cn("transition-colors duration-500 motion-reduce:transition-none",matched===undefined ? "text-foreground" : "text-[var(--success)]")} strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" />
      <motion.path initial={false} animate={{d:curve(claimed),opacity:comparing?1:0}} transition={transition} fill="none" stroke="currentColor" className="text-destructive" strokeDasharray="3 3" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" />
      <text className="fill-muted-foreground text-[6px]" x="108" y="55">input</text>
    </svg>
    {matched!==undefined && <BoundResult claim={claim ?? ""} reviewed={value} matched={matched}/>}
  </div>;
}

/** The answer, under its own curve. A match is the bound with a tick; a miss sets
 *  the learner's claim, struck through on the dashed line's colour, beside the
 *  bound on the solid one, so the legend and the result are the same thing. */
function BoundResult({claim,reviewed,matched}:{claim:string;reviewed:string;matched:boolean}){
  const bound=splitBound(reviewed).bound;
  if(matched)return <div className="mt-1.5 flex items-center gap-1.5 border-t border-[var(--glass-hairline)] pt-1.5 text-ui-sm text-[var(--success)]"><IconCheckmark1 className="size-3 shrink-0"/><span className="font-mono"><Inline text={bound}/></span><span className="ml-auto text-muted-foreground">matches</span></div>;
  return <div className="mt-1.5 space-y-0.5 border-t border-[var(--glass-hairline)] pt-1.5 text-ui-sm">
    <div className="flex items-center gap-1.5 text-destructive"><span className="w-3 shrink-0 border-t border-dashed border-current"/><span className="font-mono line-through decoration-destructive/60">{claim}</span><span className="ml-auto text-muted-foreground">yours</span></div>
    <div className="flex items-center gap-1.5 text-[var(--success)]"><span className="w-3 shrink-0 border-t-2 border-current"/><span className="font-mono"><Inline text={bound}/></span><span className="ml-auto text-muted-foreground">actual</span></div>
  </div>;
}

/** The bound arrives as a short ledger of what the code does and what each part
 *  costs, rather than a paragraph to parse — the learner checks a line against
 *  their own code, not an essay against their memory of it. */
function Breakdown({verdict,fallback}:{verdict:ComplexityVerdict|undefined;fallback:string}){
  const steps=verdict?.steps??[];
  const where=verdict?.where||[splitBound(verdict?.time??"").where,splitBound(verdict?.space??"").where].find(Boolean)||"";
  /* Reviews recorded before the ledger existed, or a reply that came back as
     prose, still read as a list: one sentence a line. */
  const sentences=steps.length?[]:(verdict?.why||fallback).split(/(?<=[.!?])\s+(?=[A-Z`\\])/).map((line)=>line.trim()).filter(Boolean);
  return <div className="rounded-[var(--radius-lg)] border border-[var(--glass-hairline)] bg-[var(--color-background-elevated-secondary)] text-ui-sm">
    {steps.length>0&&<div className="divide-y divide-[var(--glass-hairline)] px-3">
      {(["time","space"] as const).map((part)=>{const rows=steps.filter((step)=>step.part===part);return rows.length?<div className="grid grid-cols-[3.25rem_1fr_auto] gap-x-3 gap-y-1 py-2" key={part}>
        {rows.map((step,index)=><Fragment key={index}>
          <span className="text-muted-foreground">{index===0?(part==="time"?"Time":"Space"):""}</span>
          <span className="min-w-0 text-foreground/90"><Inline text={step.what}/></span>
          <span className="whitespace-nowrap text-right font-mono text-foreground"><Inline text={step.cost}/></span>
        </Fragment>)}
      </div>:null;})}
    </div>}
    {sentences.length>0&&<ul className="space-y-1 px-3 py-2.5">{sentences.map((line,index)=><li className="flex gap-2 leading-[1.5] text-foreground/85" key={index}><span className="mt-[0.55em] size-1 shrink-0 rounded-full bg-muted-foreground/60"/><span><Inline text={line}/></span></li>)}</ul>}
    {(where||(steps.length>0&&verdict?.why))&&<div className="space-y-1 border-t border-[var(--glass-hairline)] px-3 py-2 leading-[1.5] text-muted-foreground">
      {steps.length>0&&verdict?.why&&<p className="text-foreground/80"><Inline text={verdict.why}/></p>}
      {where&&<p><span className="font-mono"><Inline text={where}/></span></p>}
    </div>}
  </div>;
}

/** Stands in for the ledger while the review runs: the same shape, so the card
 *  does not jump when the answer lands, and a status line that says what is
 *  actually happening rather than a spinner on its own. */
function ReviewingSkeleton(){
  return <div aria-live="polite" className="rounded-[var(--radius-lg)] border border-[var(--glass-hairline)] bg-[var(--color-background-elevated-secondary)] px-3 py-2.5 text-ui-sm">
    <p className="thinking-shimmer font-medium">Tracing your solution’s loops and storage…</p>
    <div className="mt-2.5 space-y-2">
      {[["w-24","w-14"],["w-36","w-16"],["w-28","w-10"]].map(([what,cost],index)=><div className="grid grid-cols-[3.25rem_1fr_auto] items-center gap-x-3" key={index}>
        <span className={cn("h-2 rounded-full bg-foreground/[0.07] motion-safe:animate-pulse",index===0?"w-8":"w-0")}/>
        <span className={cn("h-2 rounded-full bg-foreground/[0.07] motion-safe:animate-pulse",what)} style={{animationDelay:`${index*150}ms`}}/>
        <span className={cn("h-2 rounded-full bg-foreground/[0.07] motion-safe:animate-pulse",cost)} style={{animationDelay:`${index*150+75}ms`}}/>
      </div>)}
    </div>
  </div>;
}

/** The headline the learner reads first, composed from the comparison. */
function VerdictBadge({verdict}:{verdict:ComplexityVerdict}){
  const both=verdict.timeMatches&&verdict.spaceMatches;
  const neither=!verdict.timeMatches&&!verdict.spaceMatches;
  const text=both?"Both bounds correct":neither?"Both bounds need another look":verdict.timeMatches?"Space needs another look":"Time needs another look";
  return <motion.span animate={{opacity:1,scale:1}} className={cn("inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-ui-sm font-medium",both?"bg-[var(--success)]/12 text-[var(--success)]":"bg-destructive/10 text-destructive")} initial={{opacity:0,scale:.92}}>{both?<IconCheckmark1 className="size-3"/>:<IconCrossMedium className="size-3"/>}{text}</motion.span>;
}

/** A field's label, and what the review made of it. */
function Field({label,matched}:{label:string;matched?:boolean|undefined}){
  return <span className="flex items-baseline gap-1.5">
    <span className="font-medium text-foreground">{label}</span>
    {matched===true&&<IconCheckmark1 className="size-3 shrink-0 self-center text-[var(--success)]"/>}
    {matched===false&&<IconCrossMedium className="size-3 shrink-0 self-center text-destructive"/>}
  </span>;
}

export function ComplexityCheckpoint({state,onChange,onReview,onAcknowledge}: {state:ComplexityCheckpointState;onChange(next:Pick<ComplexityCheckpointState,"time"|"space">):void;onReview():void;onAcknowledge():void}){
  const locked=state.phase!=="answering";
  const canReview=state.time.trim().length>0&&state.space.trim().length>0;
  /* Only once the review is in. Marking a field while the check is still running
     would be reporting a verdict that does not exist yet. */
  const reviewed=state.phase==="reviewed"||state.phase==="acknowledging";
  const matched=reviewed?state.verdict??undefined:undefined;
  return <motion.section animate={{opacity:1,y:0}} className="composer-shell overflow-hidden" initial={{opacity:0,y:8}} transition={{duration:.24,ease:[.22,.61,.36,1]}}>
    <div className="flex items-start gap-3 border-b border-[var(--glass-hairline)] px-3.5 py-3">
      <div className="min-w-0 flex-1"><h3 className="text-content font-medium">Complexity check</h3><p className="mt-0.5 text-ui-sm text-muted-foreground">What are your solution’s time and auxiliary space bounds?</p></div>
      {matched&&<VerdictBadge verdict={matched}/>}
    </div>
    <div className="space-y-3 p-3">
      {/* Once the review is in, the claims live in the graph cards beside the
          bounds they are compared with — repeating them in locked inputs above
          was the same answer said twice. */}
      <AnimatePresence initial={false}>
        {!reviewed&&<motion.div animate={{height:"auto",opacity:1}} className="overflow-hidden" exit={{height:0,opacity:0}} initial={{height:0,opacity:0}} transition={{duration:.22}}>
          <div className="grid grid-cols-2 gap-2.5">
            <label className="space-y-1.5 text-ui"><Field label="Time complexity"/><Input autoFocus={!locked} disabled={locked} onChange={(event)=>onChange({time:event.target.value,space:state.space})} placeholder="O(n log n)" value={state.time}/></label>
            <label className="space-y-1.5 text-ui"><Field label="Space complexity"/><Input disabled={locked} onChange={(event)=>onChange({time:state.time,space:event.target.value})} onKeyDown={(event)=>{if(event.key==="Enter"&&canReview&&!locked)onReview();}} placeholder="O(n)" value={state.space}/></label>
          </div>
        </motion.div>}
      </AnimatePresence>
      <div className="grid grid-cols-2 gap-2.5"><MiniGraph label="Time" value={matched?.time ?? state.time} claim={state.time} matched={matched?.timeMatches}/><MiniGraph label="Space" value={matched?.space ?? state.space} claim={state.space} matched={matched?.spaceMatches}/></div>
      <AnimatePresence initial={false} mode="popLayout">
        {state.phase==="reviewing"&&<motion.div animate={{height:"auto",opacity:1}} className="overflow-hidden" exit={{opacity:0}} initial={{height:0,opacity:0}} key="reviewing"><ReviewingSkeleton/></motion.div>}
        {reviewed&&<motion.div animate={{opacity:1,y:0}} initial={{opacity:0,y:4}} key="reviewed" transition={{duration:.25}}><Breakdown fallback={state.review} verdict={matched}/></motion.div>}
      </AnimatePresence>
      <div className="flex items-center justify-between gap-3"><p className="text-ui-sm text-muted-foreground">Chat unlocks after you acknowledge the review.</p>{state.phase==="answering"?<Button disabled={!canReview} onClick={onReview} size="sm">Check my answer<IconArrowRight/></Button>:reviewed?<Button disabled={state.phase==="acknowledging"} onClick={onAcknowledge} size="sm">{state.phase==="acknowledging"?<IconLoader className="animate-spin"/>:<IconCheckmark1/>}Noted, continue</Button>:null}</div>
    </div>
  </motion.section>;
}
