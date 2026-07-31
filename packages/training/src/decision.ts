import type { AttemptEvaluation } from "@pracai/domain";
export type EvidenceWindow={recentOutcomes:Array<AttemptEvaluation["outcome"]>;independentContexts:number;hintCount:number;daysSinceObserved:number;novelFailure:boolean};
export function recommendAction(evidence:EvidenceWindow):AttemptEvaluation["nextAction"]{
  if(evidence.daysSinceObserved>=45)return"retain";
  if(evidence.novelFailure&&evidence.recentOutcomes.at(-1)==="failed")return"diagnose";
  if(evidence.recentOutcomes.slice(-2).every(v=>v==="failed")&&evidence.hintCount>0)return"teach";
  if(evidence.recentOutcomes.at(-1)==="passed"&&evidence.independentContexts>=2)return"advance";
  if(evidence.recentOutcomes.at(-1)==="passed")return"transfer";
  return"practise";
}

