import { createHash } from "node:crypto";
import type { Env } from "./env.js";

export type StoredAgentRun = {
  id:string; userId:string; sessionId:string|null; origin:string; mode:string;
  status:string; turnKind:string|null; provider:string; model:string;
  appVersion:string|null; commitSha:string|null; input:unknown; output:unknown;
  metadata:unknown; promptTokens:number|null; completionTokens:number|null;
  cachedInputTokens:number|null; latencyMs:number|null; error:string|null;
  startedAt:Date; completedAt:Date|null;
};

export type StoredTraceEvent = {
  id:string; sequence:number; kind:string; name:string; phase:number|null;
  callId:string|null; level:string; payload:unknown; occurredAt:Date;
};
export type StoredEvalScore = { id:string; name:string; source:string; value:unknown; comment:string|null; metadata:unknown; createdAt:Date };

type OtlpConfig = { url:string; headers:Record<string,string> };

/** Exports a completed immutable trace. The database remains the durable source
 * of truth; OTLP is the presentation/analysis plane and may point at Langfuse,
 * Phoenix, or an ordinary collector. */
export class AgentTraceExporter {
  private readonly config:OtlpConfig|null;
  constructor(environment:Env,private readonly request:typeof fetch=fetch){this.config=otlpConfig(environment);}
  configured(){return Boolean(this.config);}

  async export(run:StoredAgentRun,events:StoredTraceEvent[],scores:StoredEvalScore[]=[]){
    if(!this.config)return;
    const response=await this.request(this.config.url,{
      method:"POST",
      headers:{"content-type":"application/json",...this.config.headers},
      body:JSON.stringify(otlpTrace(run,events,scores)),
      signal:AbortSignal.timeout(15_000),
    });
    if(!response.ok)throw new Error(`Telemetry export failed (${response.status})`);
  }
}

function otlpConfig(env:Env):OtlpConfig|null{
  if(env.TELEMETRY_OTLP_TRACES_URL){
    let headers:Record<string,string>={};
    if(env.TELEMETRY_OTLP_HEADERS){
      const parsed=JSON.parse(env.TELEMETRY_OTLP_HEADERS) as unknown;
      if(!parsed||typeof parsed!=="object"||Array.isArray(parsed))throw new Error("TELEMETRY_OTLP_HEADERS must be a JSON object");
      headers=Object.fromEntries(Object.entries(parsed).map(([key,value])=>[key,String(value)]));
    }
    return{url:env.TELEMETRY_OTLP_TRACES_URL,headers};
  }
  if(env.LANGFUSE_BASE_URL&&env.LANGFUSE_PUBLIC_KEY&&env.LANGFUSE_SECRET_KEY){
    const auth=Buffer.from(`${env.LANGFUSE_PUBLIC_KEY}:${env.LANGFUSE_SECRET_KEY}`).toString("base64");
    return{url:`${env.LANGFUSE_BASE_URL.replace(/\/$/,"")}/api/public/otel/v1/traces`,headers:{authorization:`Basic ${auth}`,"x-langfuse-ingestion-version":"4"}};
  }
  return null;
}

function otlpTrace(run:StoredAgentRun,events:StoredTraceEvent[],scores:StoredEvalScore[]){
  const traceId=hex(run.id,32);
  const rootSpanId=hex(`${run.id}:root`,16);
  const shared=sharedAttributes(run);
  const spans:Array<Record<string,unknown>>=[{
    traceId,spanId:rootSpanId,name:`spar.${run.origin}.${run.turnKind??"agent-turn"}`,
    startTimeUnixNano:nanos(run.startedAt),endTimeUnixNano:nanos(run.completedAt??run.startedAt),
    attributes:attributes({...shared,"langfuse.observation.type":"agent","langfuse.observation.input":json(run.input),"langfuse.observation.output":json(run.output),"langfuse.observation.level":run.error?"ERROR":"DEFAULT",...(run.error?{"langfuse.observation.status_message":run.error}:{}),...(run.origin==="eval"?{"langfuse.experiment.item.root_observation_id":rootSpanId}:{}),"spar.run.status":run.status,"spar.run.mode":run.mode}),
    status:run.error?{code:2,message:run.error}:{code:1},
  }];
  const paired=new Map<string,{start?:StoredTraceEvent;end?:StoredTraceEvent}>();
  const singles:StoredTraceEvent[]=[];
  for(const event of events){
    const state=record(event.payload).state;
    if(event.callId&&(state==="start"||state==="end")){
      const key=`${event.kind}:${event.callId}`;const pair=paired.get(key)??{};pair[state]=event;paired.set(key,pair);
    }else singles.push(event);
  }
  const spanIds=new Map<string,string>();
  for(const pair of paired.values()){const event=pair.start??pair.end!;if(event.callId)spanIds.set(event.callId,hex(`${run.id}:${event.kind}:${event.callId}`,16));}
  for(const [key,pair] of paired){
    const first=pair.start??pair.end!;const last=pair.end??pair.start!;const payload={...record(pair.start?.payload),...record(pair.end?.payload)};
    const parentCallId=typeof payload.parentCallId==="string"?payload.parentCallId:null;
    spans.push(childSpan(run,traceId,parentCallId?spanIds.get(parentCallId)??rootSpanId:rootSpanId,key,first,last,payload,first.callId?spanIds.get(first.callId):undefined));
  }
  for(const event of singles)spans.push(childSpan(run,traceId,rootSpanId,`${event.kind}:${event.id}`,event,event,record(event.payload)));
  for(const score of scores)spans.push({traceId,spanId:hex(`${run.id}:score:${score.id}`,16),parentSpanId:rootSpanId,name:score.name,startTimeUnixNano:nanos(score.createdAt),endTimeUnixNano:nanos(score.createdAt),attributes:attributes({...shared,"langfuse.observation.type":"evaluator","langfuse.observation.input":json(run.output),"langfuse.observation.output":json({value:score.value,comment:score.comment}),"langfuse.observation.metadata.source":score.source,"langfuse.observation.metadata.score":json(score.metadata)}),status:{code:1}});
  return{resourceSpans:[{resource:{attributes:attributes({"service.name":"spar-agent","service.version":run.appVersion??"unknown"})},scopeSpans:[{scope:{name:"ai.spar.agent-telemetry",version:"1"},spans}]}]};
}

function childSpan(run:StoredAgentRun,traceId:string,parentSpanId:string,key:string,first:StoredTraceEvent,last:StoredTraceEvent,payload:Record<string,unknown>,suppliedSpanId?:string){
  const kind=first.kind==="generation"?"generation":first.kind==="tool"?"tool":first.kind==="span"?"span":"event";
  const error=last.level==="ERROR"||payload.ok===false?String(payload.error??payload.detail??"Operation failed"):null;
  const input=payload.input;const output=payload.output;
  const usage=record(payload.usage);
  return{
    traceId,spanId:suppliedSpanId??hex(`${run.id}:${key}`,16),parentSpanId,name:first.name,
    startTimeUnixNano:nanos(first.occurredAt),endTimeUnixNano:nanos(last.occurredAt),
    attributes:attributes({...sharedAttributes(run),"langfuse.observation.type":kind,"langfuse.observation.level":error?"ERROR":last.level,...(error?{"langfuse.observation.status_message":error}:{}),...(input!==undefined?{"langfuse.observation.input":json(input)}:{}),...(output!==undefined?{"langfuse.observation.output":json(output)}:{}),...(kind==="generation"?{"langfuse.observation.model.name":String(payload.model??run.model),"langfuse.observation.usage_details":json(usage)}:{}),"langfuse.observation.metadata.sequence":first.sequence,"langfuse.observation.metadata.phase":first.phase??"","spar.call.id":first.callId??""}),
    status:error?{code:2,message:error}:{code:1},
  };
}

function sharedAttributes(run:StoredAgentRun){const metadata=record(run.metadata);const evalAttributes=run.origin==="eval"?{"langfuse.experiment.id":String(metadata.experimentId??run.id),"langfuse.experiment.name":String(metadata.experimentName??"spar-eval"),"langfuse.experiment.dataset.id":String(metadata.datasetId??"spar-agent-scenarios"),"langfuse.experiment.item.id":String(metadata.itemId??run.id),"langfuse.environment":"experiment"}:{};return{"langfuse.trace.name":`spar.${run.origin}.${run.turnKind??"agent-turn"}`,"langfuse.user.id":run.userId,...(run.sessionId?{"langfuse.session.id":run.sessionId}:{}),"langfuse.trace.tags":[run.origin,run.mode,run.provider],"langfuse.release":run.commitSha??run.appVersion??"unknown","langfuse.version":run.appVersion??"unknown","langfuse.environment":process.env.NODE_ENV??"development","langfuse.trace.metadata.provider":run.provider,"langfuse.trace.metadata.model":run.model,"langfuse.trace.metadata.mode":run.mode,...evalAttributes};}
function attributes(values:Record<string,unknown>){return Object.entries(values).filter(([,value])=>value!==undefined&&value!==null).map(([key,value])=>({key,value:attributeValue(value)}));}
function attributeValue(value:unknown):Record<string,unknown>{if(typeof value==="boolean")return{boolValue:value};if(typeof value==="number")return Number.isInteger(value)?{intValue:String(value)}:{doubleValue:value};if(Array.isArray(value))return{arrayValue:{values:value.map(attributeValue)}};return{stringValue:String(value)};}
function record(value:unknown):Record<string,unknown>{return value&&typeof value==="object"&&!Array.isArray(value)?value as Record<string,unknown>:{};}
function json(value:unknown){try{return JSON.stringify(value);}catch{return JSON.stringify({serializationError:true});}}
function nanos(value:Date){return String(BigInt(value.getTime())*1_000_000n);}
function hex(seed:string,length:number){return createHash("sha256").update(seed).digest("hex").slice(0,length);}
