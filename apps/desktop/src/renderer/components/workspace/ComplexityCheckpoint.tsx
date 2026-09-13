import { ArrowRight, Check, Loader2, X } from "lucide-react";
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

function MiniGraph({value,label,claim,matched}: {value:string;label:string;claim?:string;matched?:boolean | undefined}){
  const growth=growthFromComplexity(value);
  const claimed=growthFromComplexity(claim ?? value);
  const comparing=matched===false;
  const reducedMotion=useReducedMotion();
  const transition={duration:reducedMotion ? 0 : 0.6,ease:[0.22,0.61,0.36,1] as const};
  return <div className="rounded-[var(--radius-lg)] border border-[var(--glass-hairline)] bg-[var(--color-background-surface-under)] px-2.5 pb-2 pt-2">
    <div className="mb-1 flex items-center justify-between text-ui-sm"><span className="font-medium text-foreground/80">{label}</span><span className="text-muted-foreground">{LABEL[growth]}</span></div>
    <svg aria-label={comparing ? `${label}: your answer ${claim}; reviewed bound ${value}. Illustrative growth curves.` : `${label} ${LABEL[growth]} growth preview`} className="h-12 w-full overflow-visible" role="img" viewBox="0 0 120 56">
      <path d="M 8 48 H 114 M 8 48 V 8" fill="none" stroke="currentColor" className="text-border" strokeWidth="1" />
      <motion.path initial={false} animate={{d:curve(growth),opacity:growth==="unknown"?0.25:1}} transition={transition} fill="none" stroke="currentColor" className={cn("transition-colors duration-500 motion-reduce:transition-none",matched===undefined ? "text-foreground" : "text-[var(--success)]")} strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" />
      <motion.path initial={false} animate={{d:curve(claimed),opacity:comparing?1:0}} transition={transition} fill="none" stroke="currentColor" className="text-destructive" strokeDasharray="3 3" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" />
      <text className="fill-muted-foreground text-[6px]" x="108" y="55">input</text>
    </svg>
    {matched!==undefined && <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-ui-sm">
      {comparing && <span className="text-destructive">┄ Your answer · {LABEL[claimed]}</span>}
      <span className="text-[var(--success)]">— {comparing ? "Reviewed" : "Your answer matches"} · {LABEL[growth]}</span>
      <span className="w-full text-muted-foreground">Illustrative growth, normalized</span>
    </div>}
  </div>;
}


/** A field's label, and what the review made of it. The true bound is printed
 *  beside a claim that missed: the learner asked a question and the answer is a
 *  bound, not a cross. */
function Field({label,matched}:{label:string;matched?:boolean|undefined;truth?:string|undefined}){
  return <span className="flex items-baseline gap-1.5">
    <span className="text-ui font-medium text-foreground/80">{label}</span>
    {matched===true&&<Check className="size-3 shrink-0 self-center text-[var(--success)]"/>}
    {matched===false&&<X className="size-3 shrink-0 self-center text-destructive"/>}
  </span>;
}

/** The claim itself, tinted by the verdict. */
const fieldTone=(matched?:boolean)=>matched===undefined?undefined:matched?"border-[var(--success)]/40":"border-destructive/40 text-destructive";

export function ComplexityCheckpoint({state,onChange,onReview,onAcknowledge}: {state:ComplexityCheckpointState;onChange(next:Pick<ComplexityCheckpointState,"time"|"space">):void;onReview():void;onAcknowledge():void}){
  const locked=state.phase!=="answering";
  const canReview=state.time.trim().length>0&&state.space.trim().length>0;
  /* Only once the review is in. Marking a field while the check is still running
     would be reporting a verdict that does not exist yet. */
  const matched=state.phase==="reviewed"||state.phase==="acknowledging"?state.verdict??undefined:undefined;
  const right=matched?matched.timeMatches&&matched.spaceMatches:undefined;
  return <motion.section animate={{opacity:1,y:0}} className="composer-shell overflow-hidden" initial={{opacity:0,y:8}} transition={{duration:.24,ease:[.22,.61,.36,1]}}>
    <div className="flex items-start gap-3 border-b border-[var(--glass-hairline)] px-3.5 py-3">
      <div className="min-w-0 flex-1"><h3 className="text-content font-medium">Complexity check</h3><p className="mt-0.5 text-ui-sm text-muted-foreground">What are your solution’s time and auxiliary space bounds?</p></div>
    </div>
    <div className="space-y-3 p-3">
      <div className="grid grid-cols-2 gap-2.5">
        <label className="space-y-1.5"><Field label="Time complexity" matched={matched?.timeMatches} truth={state.verdict?.time}/><Input autoFocus={!locked} className={fieldTone(matched?.timeMatches)} disabled={locked} onChange={(event)=>onChange({time:event.target.value,space:state.space})} placeholder="O(n log n)" value={state.time}/></label>
        <label className="space-y-1.5"><Field label="Space complexity" matched={matched?.spaceMatches} truth={state.verdict?.space}/><Input className={fieldTone(matched?.spaceMatches)} disabled={locked} onChange={(event)=>onChange({time:state.time,space:event.target.value})} onKeyDown={(event)=>{if(event.key==="Enter"&&canReview&&!locked)onReview();}} placeholder="O(n)" value={state.space}/></label>
      </div>
      {matched && <div className="grid grid-cols-2 gap-2.5 text-ui-sm">
        <p className="text-muted-foreground">Reviewed time <span className="font-medium text-foreground"><Inline text={matched.time}/></span></p>
        <p className="text-muted-foreground">Reviewed space <span className="font-medium text-foreground"><Inline text={matched.space}/></span></p>
      </div>}
      <div className="grid grid-cols-2 gap-2.5"><MiniGraph label="Time" value={matched?.time ?? state.time} claim={state.time} matched={matched?.timeMatches}/><MiniGraph label="Space" value={matched?.space ?? state.space} claim={state.space} matched={matched?.spaceMatches}/></div>
      <AnimatePresence initial={false}>
        {state.phase!=="answering"&&<motion.div animate={{height:"auto",opacity:1}} className="overflow-hidden" initial={{height:0,opacity:0}}>
          <div className="flex items-start gap-2 rounded-[var(--radius-lg)] border border-[var(--glass-hairline)] bg-[var(--color-background-elevated-secondary)] px-3 py-2.5 text-ui leading-[1.55]">
            {state.phase==="reviewing"
              ?<Loader2 className="mt-0.5 size-3.5 shrink-0 animate-spin"/>
              /* The tick used to be unconditional, which is how a review saying
                 the space bound was wrong arrived under a check mark. */
              :right===false?<X className="mt-0.5 size-3.5 shrink-0 text-destructive"/>
              :<Check className={cn("mt-0.5 size-3.5 shrink-0",right&&"text-[var(--success)]")}/>}
            {/* The review is written by the model, in the language the model writes
                prose in: backticks around an identifier, and TeX around a bound.
                Rendered through the same inline renderer the transcript uses, so
                `\(O(1)\)` arrives as O(1) rather than as its delimiters. */}
            <p className="text-foreground/85">{state.phase==="reviewing"?"Checking your code…":<Inline text={matched?.why || state.review}/>}</p>
          </div>
        </motion.div>}
      </AnimatePresence>
      <div className="flex items-center justify-between gap-3"><p className="text-ui-sm text-muted-foreground">Chat unlocks after you acknowledge the review.</p>{state.phase==="answering"?<Button disabled={!canReview} onClick={onReview} size="sm">Check my answer<ArrowRight/></Button>:state.phase==="reviewed"||state.phase==="acknowledging"?<Button disabled={state.phase==="acknowledging"} onClick={onAcknowledge} size="sm">{state.phase==="acknowledging"?<Loader2 className="animate-spin"/>:<Check/>}Noted, continue</Button>:null}</div>
    </div>
  </motion.section>;
}
