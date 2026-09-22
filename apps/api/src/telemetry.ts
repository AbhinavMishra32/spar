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

type OtlpConfig = { kind:"otlp"; url:string; headers:Record<string,string> } | { kind:"langsmith"; url:string; apiKey:string; project:string };

/** Exports a completed immutable trace. The database remains the durable source
 * of truth; OTLP is the presentation/analysis plane and may point at Langfuse,
 * Phoenix, or an ordinary collector. */
export class AgentTraceExporter {
  private readonly config:OtlpConfig|null;
  constructor(environment:Env,private readonly request:typeof fetch=fetch){this.config=otlpConfig(environment);}
  configured(){return Boolean(this.config);}

  async export(run:StoredAgentRun,events:StoredTraceEvent[],scores:StoredEvalScore[]=[]){
    if(!this.config)return;
    if(this.config.kind==="langsmith")return this.exportLangSmith(run,events,scores);
    const response=await this.request(this.config.url,{
      method:"POST",
      headers:{"content-type":"application/json",...this.config.headers},
      body:JSON.stringify(otlpTrace(run,events,scores)),
      signal:AbortSignal.timeout(15_000),
    });
    if(!response.ok)throw new Error(`Telemetry export failed (${response.status})`);
  }

  private async exportLangSmith(run:StoredAgentRun,events:StoredTraceEvent[],scores:StoredEvalScore[]){
    const config=this.config;
    if(!config||config.kind!=="langsmith")return;
    const spans=traceSpans(run,events,scores);
    const dotted=new Map<string,string>();
    const ordered=(span:TraceSpan)=>`${compactTime(span.startTimeUnixNano)}${uuid(span.spanId)}`;
    const root=spans.find((span)=>!span.parentSpanId)??spans[0];
    if(root)dotted.set(root.spanId,ordered(root));
    for(const span of spans){if(!dotted.has(span.spanId)){const parent=span.parentSpanId?dotted.get(span.parentSpanId):undefined;dotted.set(span.spanId,parent?`${parent}.${ordered(span)}`:ordered(span));}}
    const post=spans.map((span)=>langSmithRun(span,run,config.project,dotted.get(span.spanId)!));
    const response=await this.request(`${config.url.replace(/\/$/,"")}/runs/batch`,{method:"POST",headers:{"content-type":"application/json","x-api-key":config.apiKey},body:JSON.stringify({post,patch:[]}),signal:AbortSignal.timeout(15_000)});
    if(!response.ok)throw new Error(`LangSmith telemetry export failed (${response.status})`);
  }
}

function otlpConfig(env:Env):OtlpConfig|null{
  if(env.LANGSMITH_API_KEY&&env.LANGSMITH_ENDPOINT&&env.LANGSMITH_PROJECT&&env.LANGSMITH_TRACING!=="false")return{kind:"langsmith",url:env.LANGSMITH_ENDPOINT,apiKey:env.LANGSMITH_API_KEY,project:env.LANGSMITH_PROJECT};
  if(env.TELEMETRY_OTLP_TRACES_URL){
    let headers:Record<string,string>={};
    if(env.TELEMETRY_OTLP_HEADERS){
      const parsed=JSON.parse(env.TELEMETRY_OTLP_HEADERS) as unknown;
      if(!parsed||typeof parsed!=="object"||Array.isArray(parsed))throw new Error("TELEMETRY_OTLP_HEADERS must be a JSON object");
      headers=Object.fromEntries(Object.entries(parsed).map(([key,value])=>[key,String(value)]));
    }
    return{kind:"otlp",url:env.TELEMETRY_OTLP_TRACES_URL,headers};
  }
  if(env.LANGFUSE_BASE_URL&&env.LANGFUSE_PUBLIC_KEY&&env.LANGFUSE_SECRET_KEY){
    const auth=Buffer.from(`${env.LANGFUSE_PUBLIC_KEY}:${env.LANGFUSE_SECRET_KEY}`).toString("base64");
    return{kind:"otlp",url:`${env.LANGFUSE_BASE_URL.replace(/\/$/,"")}/api/public/otel/v1/traces`,headers:{authorization:`Basic ${auth}`,"x-langfuse-ingestion-version":"4"}};
  }
  return null;
}

function otlpTrace(run:StoredAgentRun,events:StoredTraceEvent[],scores:StoredEvalScore[]){
  const spans=traceSpans(run,events,scores);
  return{resourceSpans:[{resource:{attributes:attributes({"service.name":"spar-agent","service.version":run.appVersion??"unknown"})},scopeSpans:[{scope:{name:"ai.spar.agent-telemetry",version:"1"},spans}]}]};
}
type TraceSpan={traceId:string;spanId:string;parentSpanId?:string;name:string;startTimeUnixNano:string;endTimeUnixNano:string;attributes:Array<{key:string;value:Record<string,unknown>}>;status:{code:number;message?:string}};
function traceSpans(run:StoredAgentRun,events:StoredTraceEvent[],scores:StoredEvalScore[]):TraceSpan[]{
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
  return spans as TraceSpan[];
}

function langSmithRun(span:TraceSpan,run:StoredAgentRun,project:string,dottedOrder:string){
  const type=attributeText(span,"langfuse.observation.type");
  const input=attributeJson(span,"langfuse.observation.input");
  const output=attributeJson(span,"langfuse.observation.output");
  const metadata={sparRunId:run.id,sparOrigin:run.origin,sparMode:run.mode,provider:run.provider,model:run.model,release:run.commitSha??run.appVersion??"unknown",...(run.sessionId?{sessionId:run.sessionId}:{}),...(run.origin==="eval"?{experiment:true}:{}),...attributeMetadata(span)};
  return{
    id:uuid(span.spanId),name:span.name,run_type:type==="generation"?"llm":type==="tool"?"tool":"chain",
    project_name:project,session_name:project,trace_id:uuid(span.traceId),dotted_order:dottedOrder,
    ...(span.parentSpanId?{parent_run_id:uuid(span.parentSpanId)}:{}),
    start_time:Number(BigInt(span.startTimeUnixNano)/1_000_000n),end_time:Number(BigInt(span.endTimeUnixNano)/1_000_000n),
    inputs:{value:input},outputs:{value:output},extra:{metadata,invocation_params:type==="generation"?{model:attributeText(span,"langfuse.observation.model.name")}:{}},
    ...(span.status.code===2?{error:span.status.message??"Trace operation failed"}:{}),tags:[run.origin,run.mode,run.provider],serialized:{name:span.name},
  };
}

function attributeText(span:TraceSpan,key:string){const value=span.attributes.find((item)=>item.key===key)?.value;return typeof value?.stringValue==="string"?value.stringValue:"";}
function attributeJson(span:TraceSpan,key:string){const value=attributeText(span,key);try{return value?JSON.parse(value):{}}catch{return{value};}}
function attributeMetadata(span:TraceSpan){const metadata:Record<string,unknown>={};for(const item of span.attributes){if(item.key.startsWith("langfuse.observation.metadata.")){metadata[item.key.slice("langfuse.observation.metadata.".length)]=item.value.stringValue??item.value.intValue??item.value.doubleValue??item.value.boolValue;}}return metadata;}

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
function uuid(value:string){const normalized=value.length>=32?value.slice(0,32):hex(value,32);return`${normalized.slice(0,8)}-${normalized.slice(8,12)}-4${normalized.slice(13,16)}-a${normalized.slice(17,20)}-${normalized.slice(20,32)}`;}
function compactTime(nanoseconds:string){return new Date(Number(BigInt(nanoseconds)/1_000_000n)).toISOString().replace(/[-:.]/g,"");}
