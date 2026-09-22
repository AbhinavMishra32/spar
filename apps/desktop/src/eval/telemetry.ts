import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import type { Scorecard, Trace } from "@spar/eval";

/** Uploads the artifacts the eval already wrote; it never changes scoring or
 * gates. CI opts in by supplying its normal Spar bearer token and API origin,
 * after which every scripted/replay/live run appears beside product traces in
 * the observability UI with an explicit `eval` origin and mode. */
export async function uploadEvalTelemetry(traces:Trace[],scorecards:Scorecard[],environment=process.env){
  const origin=environment.SPAR_TELEMETRY_ORIGIN?.replace(/\/$/,"");const token=environment.SPAR_TELEMETRY_TOKEN;
  if(!origin||!token)return{uploaded:0,configured:false};
  const byRun=new Map(scorecards.map((card)=>[card.run.runId,card]));
  const commit=environment.GITHUB_SHA??gitCommit();
  const experimentId=uuidFrom(`spar-eval-suite:${traces[0]?.header.arm??"eval"}:${commit??"working-tree"}:${new Date().toISOString()}`);
  for(const trace of traces){
    const id=uuidFrom(`spar-eval:${trace.header.runId}:${trace.header.startedAt}`);const started=Date.parse(trace.header.startedAt);const last=trace.events.at(-1);const completedAt=new Date(started+(last?.atMs??0)).toISOString();
    await send(origin,token,`/v1/telemetry/runs/${id}`,"PUT",{id,origin:"eval",mode:trace.header.mode,status:"running",turnKind:"eval-scenario",provider:String(trace.header.config.provider??"eval"),model:trace.header.model||"scripted",schemaVersion:trace.header.schemaVersion,commitSha:commit,input:{scenario:trace.header.scenario,seed:trace.header.seed},metadata:{arm:trace.header.arm,scenario:trace.header.scenario,seed:trace.header.seed,config:trace.header.config,experimentId,experimentName:`spar-${trace.header.arm}`,datasetId:"spar-agent-scenarios",itemId:`${trace.header.scenario}:${trace.header.seed}`},startedAt:trace.header.startedAt});
    for(let index=0;index<trace.events.length;index+=64){const events=trace.events.slice(index,index+64).map((event)=>({id:uuidFrom(`${id}:${event.seq}`),runId:id,sequence:event.seq,kind:eventKind(event.kind),name:eventName(event),phase:"step" in event?event.step:null,callId:null,level:event.kind==="error"?"ERROR":"DEFAULT",payload:event,occurredAt:new Date(started+event.atMs).toISOString()}));await send(origin,token,`/v1/telemetry/runs/${id}/events`,"POST",{events});}
    const card=byRun.get(trace.header.runId);const usage=trace.events.filter((event)=>event.kind==="model_response").reduce((total,event)=>event.kind==="model_response"&&event.usage?{inputTokens:total.inputTokens+event.usage.inputTokens,outputTokens:total.outputTokens+event.usage.outputTokens,cachedInputTokens:total.cachedInputTokens+event.usage.cachedInputTokens}:total,{inputTokens:0,outputTokens:0,cachedInputTokens:0});
    if(card){const scores=[...card.checks.map((check)=>({name:check.id,source:"deterministic",value:check.outcome,comment:check.detail,metadata:{at:check.at??[]}})),...Object.entries(card.measures).map(([name,value])=>({name,source:"measure",value,metadata:{}}))];if(scores.length)await send(origin,token,`/v1/telemetry/runs/${id}/scores`,"POST",{scores});}
    await send(origin,token,`/v1/telemetry/runs/${id}`,"PATCH",{id,status:card?.error?"error":"completed",output:{checks:card?.checks??[],measures:card?.measures??{}},promptTokens:usage.inputTokens,completionTokens:usage.outputTokens,cachedInputTokens:usage.cachedInputTokens,eventCount:trace.events.length,latencyMs:last?.atMs??0,error:card?.error??null,completedAt});
  }
  return{uploaded:traces.length,configured:true};
}

async function send(origin:string,token:string,path:string,method:string,body:unknown){const response=await fetch(`${origin}${path}`,{method,headers:{authorization:`Bearer ${token}`,"content-type":"application/json"},body:JSON.stringify(body),signal:AbortSignal.timeout(20_000)});if(!response.ok)throw new Error(`Eval telemetry ${method} ${path} failed (${response.status}): ${(await response.text()).slice(0,500)}`);}
function uuidFrom(value:string){const hex=createHash("sha256").update(value).digest("hex").slice(0,32);return`${hex.slice(0,8)}-${hex.slice(8,12)}-4${hex.slice(13,16)}-a${hex.slice(17,20)}-${hex.slice(20,32)}`;}
function gitCommit(){try{return execFileSync("git",["rev-parse","HEAD"],{encoding:"utf8",stdio:["ignore","pipe","ignore"]}).trim();}catch{return undefined;}}
function eventKind(kind:string){if(kind.startsWith("model_"))return"generation";if(kind.startsWith("tool_"))return"tool";if(kind==="stage")return"agent";if(kind==="error")return"event";return"event";}
function eventName(event:Trace["events"][number]){if(event.kind==="tool_call"||event.kind==="tool_result")return event.name;if(event.kind==="model_request"||event.kind==="model_response")return`eval-model-step-${event.step}`;return event.kind;}
