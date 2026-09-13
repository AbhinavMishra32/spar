import { ArrowRight, Check, Loader2 } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

export type ComplexityCheckpointState = {
  phase: "answering" | "reviewing" | "reviewed" | "acknowledging";
  time: string;
  space: string;
  review: string;
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

function MiniGraph({value,label}: {value:string;label:string}){
  const growth=growthFromComplexity(value);
  return <div className="rounded-[var(--radius-lg)] border border-[var(--glass-hairline)] bg-[var(--color-background-surface-under)] px-2.5 pb-2 pt-2">
    <div className="mb-1 flex items-center justify-between text-ui-sm"><span className="font-medium text-foreground/80">{label}</span><span className="text-muted-foreground">{LABEL[growth]}</span></div>
    <svg aria-label={`${label} ${LABEL[growth]} growth preview`} className="h-12 w-full overflow-visible" role="img" viewBox="0 0 120 56">
      <path d="M 8 48 H 114 M 8 48 V 8" fill="none" stroke="currentColor" className="text-border" strokeWidth="1" />
      <path d={curve(growth)} fill="none" stroke="currentColor" className={cn("text-foreground transition-opacity",growth==="unknown"&&"opacity-25")} strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" />
      <circle cx="112" cy={growth==="constant"?28:12} fill="currentColor" className={cn("text-foreground",growth==="unknown"&&"opacity-25")} r="2.2" />
      <text className="fill-muted-foreground text-[6px]" x="108" y="55">input</text>
    </svg>
  </div>;
}

export function ComplexityCheckpoint({state,onChange,onReview,onAcknowledge}: {state:ComplexityCheckpointState;onChange(next:Pick<ComplexityCheckpointState,"time"|"space">):void;onReview():void;onAcknowledge():void}){
  const locked=state.phase!=="answering";
  const canReview=state.time.trim().length>0&&state.space.trim().length>0;
  return <motion.section animate={{opacity:1,y:0}} className="composer-shell overflow-hidden" initial={{opacity:0,y:8}} transition={{duration:.24,ease:[.22,.61,.36,1]}}>
    <div className="flex items-start gap-3 border-b border-[var(--glass-hairline)] px-3.5 py-3">
      <span className="mt-0.5 grid size-6 shrink-0 place-items-center rounded-full bg-[var(--color-background-elevated-secondary)] text-ui-sm font-semibold">Ω</span>
      <div className="min-w-0 flex-1"><h3 className="text-content font-medium">One last check</h3><p className="mt-0.5 text-ui leading-[1.5] text-muted-foreground">Your solution passed. State its worst-case bounds before Spar reviews the code.</p></div>
    </div>
    <div className="space-y-3 p-3">
      <div className="grid grid-cols-2 gap-2.5">
        <label className="space-y-1.5"><span className="text-ui font-medium text-foreground/80">Time complexity</span><Input autoFocus={!locked} disabled={locked} onChange={(event)=>onChange({time:event.target.value,space:state.space})} placeholder="O(n log n)" value={state.time}/></label>
        <label className="space-y-1.5"><span className="text-ui font-medium text-foreground/80">Space complexity</span><Input disabled={locked} onChange={(event)=>onChange({time:state.time,space:event.target.value})} onKeyDown={(event)=>{if(event.key==="Enter"&&canReview&&!locked)onReview();}} placeholder="O(n)" value={state.space}/></label>
      </div>
      <div className="grid grid-cols-2 gap-2.5"><MiniGraph label="Time" value={state.time}/><MiniGraph label="Space" value={state.space}/></div>
      <AnimatePresence initial={false}>
        {state.phase!=="answering"&&<motion.div animate={{height:"auto",opacity:1}} className="overflow-hidden" initial={{height:0,opacity:0}}>
          <div className="flex items-start gap-2 rounded-[var(--radius-lg)] border border-[var(--glass-hairline)] bg-[var(--color-background-elevated-secondary)] px-3 py-2.5 text-ui leading-[1.55]">
            {state.phase==="reviewing"?<Loader2 className="mt-0.5 size-3.5 shrink-0 animate-spin"/>:<Check className="mt-0.5 size-3.5 shrink-0"/>}
            <p className="text-foreground/85">{state.phase==="reviewing"?"Checking those bounds against your submitted code…":state.review}</p>
          </div>
        </motion.div>}
      </AnimatePresence>
      <div className="flex items-center justify-between gap-3"><p className="text-ui-sm text-muted-foreground">Chat unlocks after you acknowledge the review.</p>{state.phase==="answering"?<Button disabled={!canReview} onClick={onReview} size="sm">Check my answer<ArrowRight/></Button>:state.phase==="reviewed"||state.phase==="acknowledging"?<Button disabled={state.phase==="acknowledging"} onClick={onAcknowledge} size="sm">{state.phase==="acknowledging"?<Loader2 className="animate-spin"/>:<Check/>}Noted, continue</Button>:null}</div>
    </div>
  </motion.section>;
}
