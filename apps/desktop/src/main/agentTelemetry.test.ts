import { describe,expect,it } from "vitest";
import { AgentTelemetry } from "./agentTelemetry.js";
import type { LocalStore } from "./store.js";
import type { AgentTraceSink } from "./devLangSmith.js";

describe("durable agent telemetry",()=>{
  it("sequences controller events without persisting token deltas",()=>{
    const queued:Array<{kind:string;payload:Record<string,unknown>}>=[];
    const exported:Array<{kind:string;payload:Record<string,unknown>}>=[];
    const recorded:Array<Record<string,unknown>>=[];
    const store={queueAgentTelemetry:(kind:string,payload:Record<string,unknown>)=>queued.push({kind,payload}),recordAgentUsage:(row:Record<string,unknown>)=>recorded.push(row)} as unknown as LocalStore;
    const trace={
      start:(payload:Record<string,unknown>)=>exported.push({kind:"start",payload}),
      record:(payload:Record<string,unknown>)=>exported.push({kind:"record",payload}),
      finish:(payload:Record<string,unknown>)=>exported.push({kind:"finish",payload}),
    } as AgentTraceSink;
    const telemetry=new AgentTelemetry(store,trace);
    telemetry.start({runId:"11111111-1111-4111-a111-111111111111",sessionId:"22222222-2222-4222-a222-222222222222",provider:"openai",model:"gpt-test",turnKind:"learner-message",input:{message:"hello"},appVersion:"0.6.9"});
    telemetry.record("11111111-1111-4111-a111-111111111111",{type:"text",text:"token"});
    telemetry.record("11111111-1111-4111-a111-111111111111",{type:"status",detail:"phase-step:0"});
    telemetry.record("11111111-1111-4111-a111-111111111111",{type:"telemetry",kind:"tool",name:"read_attempt",phase:"start",callId:"c1",input:{attemptId:"a1"}});
    telemetry.finish("11111111-1111-4111-a111-111111111111",{text:"done",finishReason:"stop",usage:{inputTokens:3,outputTokens:1,cachedInputTokens:2,cacheWriteTokens:1,costUsd:0.0125}});
    expect(queued.map((item)=>item.kind)).toEqual(["agent-run-start","agent-trace-event","agent-trace-event","agent-run-finish"]);
    expect(queued.slice(1,3).map((item)=>item.payload.sequence)).toEqual([0,1]);
    expect((queued[2]!.payload.payload as Record<string,unknown>).state).toBe("start");
    expect(exported.map((item)=>item.kind)).toEqual(["start","record","record","finish"]);
    expect(exported[0]!.payload.startedAt).toEqual(expect.any(String));
    expect(queued[3]!.payload.estimatedCostMicros).toBe(12_500);
    expect(recorded).toEqual([expect.objectContaining({sessionId:"22222222-2222-4222-a222-222222222222",model:"gpt-test",status:"completed",inputTokens:3,outputTokens:1,cachedInputTokens:2,cacheWriteTokens:1,costUsd:0.0125})]);
  });
  it("persists the private fit verdict and its evidence-based reason",()=>{
    const queued:Array<{kind:string;payload:Record<string,unknown>}>=[];
    const exported:Array<Record<string,unknown>>=[];
    const store={queueAgentTelemetry:(kind:string,payload:Record<string,unknown>)=>queued.push({kind,payload}),recordAgentUsage:()=>undefined} as unknown as LocalStore;
    const trace={start:()=>undefined,record:(payload:Record<string,unknown>)=>exported.push(payload),finish:()=>undefined} as AgentTraceSink;
    const telemetry=new AgentTelemetry(store,trace);
    const runId="11111111-1111-4111-a111-111111111111";
    telemetry.start({runId,sessionId:"22222222-2222-4222-a222-222222222222",provider:"openai",model:"gpt-test",turnKind:"learner-message",input:{message:"another question"},appVersion:"0.6.10"});
    telemetry.record(runId,{type:"telemetry",kind:"event",name:"challenge-fit-verdict",callId:"review-1",parentCallId:"question-1",attributes:{pass:1,verdict:"revise",reason:"The learner already passed this position lookup.",candidateTitle:"Next Greater Positions"}});
    expect(queued[1]).toMatchObject({kind:"agent-trace-event",payload:{name:"challenge-fit-verdict",kind:"event",payload:{parentCallId:"question-1",attributes:{verdict:"revise",reason:"The learner already passed this position lookup."}}}});
    expect(exported[0]).toMatchObject({name:"challenge-fit-verdict",payload:{attributes:{pass:1,candidateTitle:"Next Greater Positions"}}});
  });
});
