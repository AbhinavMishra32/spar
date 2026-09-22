import { randomUUID } from "node:crypto";
import type { SpanAttributes, SpanOptions, SpanStatus, TelemetryContext, TelemetrySpan } from "@earendil-works/pi-telemetry";

/** Adapts Pi's explicit, vendor-neutral telemetry contract to Spar's durable
 * worker event stream. Pi supplies provider/request internals; Spar wraps these
 * beneath its controller generations, tools, retries, and eval metadata. */
export class WorkerTelemetryContext implements TelemetryContext {
  constructor(private readonly runId:string,private readonly parentCallId?:string){}

  async startSpan<T>(options:SpanOptions,callback:(span:TelemetrySpan)=>T|Promise<T>):Promise<T>{
    const callId=randomUUID();let attributes={...(options.attributes??{})};let status:SpanStatus={status:"ok"};let settled=false;
    safePost(this.runId,{type:"telemetry",kind:"span",name:options.name,state:"start",callId,parentCallId:this.parentCallId,attributes});
    const child=new WorkerTelemetryContext(this.runId,callId);
    const span:TelemetrySpan={
      startSpan:child.startSpan.bind(child),
      addEvent:(name,eventAttributes)=>{if(!settled)safePost(this.runId,{type:"telemetry",kind:"event",name,callId:randomUUID(),parentCallId:callId,attributes:eventAttributes??{}});},
      setAttributes:(next)=>{if(!settled)attributes={...attributes,...defined(next)};},
      setStatus:(next)=>{if(!settled)status=next;},
    };
    try{return await callback(span);}catch(error){status={status:"error",error:{name:error instanceof Error?error.name:"Error",message:error instanceof Error?error.message:String(error)}};throw error;}finally{settled=true;safePost(this.runId,{type:"telemetry",kind:"span",name:options.name,state:"end",callId,parentCallId:this.parentCallId,attributes,status,level:status.status==="error"?"ERROR":"DEFAULT"});}
  }
}

function defined(values:SpanAttributes){return Object.fromEntries(Object.entries(values).filter(([,value])=>value!==undefined)) as SpanAttributes;}
function safePost(runId:string,event:Record<string,unknown>){try{process.parentPort?.postMessage({kind:"event",requestId:runId,event});}catch{/* Telemetry must never change an agent run's outcome. */}}
