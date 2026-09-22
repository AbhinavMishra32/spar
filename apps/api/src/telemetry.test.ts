import { describe, expect, it, vi } from "vitest";
import { envSchema } from "./env.js";
import { AgentTraceExporter, type StoredAgentRun, type StoredTraceEvent } from "./telemetry.js";

const run:StoredAgentRun={id:"11111111-1111-4111-a111-111111111111",userId:"22222222-2222-4222-a222-222222222222",sessionId:"33333333-3333-4333-a333-333333333333",origin:"product",mode:"live",status:"completed",turnKind:"learner-message",provider:"openai",model:"gpt-test",appVersion:"0.6.9",commitSha:null,input:{message:"hello"},output:{text:"done"},metadata:{},promptTokens:10,completionTokens:4,cachedInputTokens:2,latencyMs:20,error:null,startedAt:new Date("2026-01-01T00:00:00.000Z"),completedAt:new Date("2026-01-01T00:00:00.020Z")};

describe("agent OTLP export",()=>{
  it("exports one hierarchy with paired generation and tool spans",async()=>{
    let body:Record<string,unknown>|undefined;
    const request=vi.fn(async(_url:unknown,init?:RequestInit)=>{body=JSON.parse(String(init?.body)) as Record<string,unknown>;return new Response(null,{status:200});}) as unknown as typeof fetch;
    const env=envSchema.parse({DATABASE_URL:"postgresql://localhost/spar",AUTH_SECRET:"x".repeat(32),TELEMETRY_OTLP_TRACES_URL:"https://otel.example/v1/traces",TELEMETRY_OTLP_HEADERS:'{"x-api-key":"secret"}'});
    const exporter=new AgentTraceExporter(env,request);
    const events:StoredTraceEvent[]=[event(0,"generation","pi-phase-0","call-1","start",0),event(1,"tool","read_attempt","tool-1","start",2),event(2,"tool","read_attempt","tool-1","end",6,{ok:true,output:{rows:2}}),event(3,"generation","pi-phase-0","call-1","end",10,{model:"gpt-test",usage:{inputTokens:10,outputTokens:4},output:{content:"done"}})];
    await exporter.export(run,events);
    expect(request).toHaveBeenCalledOnce();
    const resource=(body?.resourceSpans as Array<{scopeSpans:Array<{spans:Array<Record<string,unknown>>}>}>)[0]!;
    const spans=resource.scopeSpans[0]!.spans;
    expect(spans.map((span)=>span.name)).toEqual(["spar.product.learner-message","pi-phase-0","read_attempt"]);
    expect(spans[1]!.parentSpanId).toBe(spans[0]!.spanId);
    expect(spans[2]!.parentSpanId).toBe(spans[0]!.spanId);
  });
});

function event(sequence:number,kind:string,name:string,callId:string,state:string,ms:number,extra:Record<string,unknown>={}):StoredTraceEvent{return{id:`${sequence}`.padStart(8,"0")+"-0000-4000-a000-000000000000",sequence,kind,name,phase:0,callId,level:"DEFAULT",payload:{state,...extra},occurredAt:new Date(Date.parse("2026-01-01T00:00:00.000Z")+ms)};}
