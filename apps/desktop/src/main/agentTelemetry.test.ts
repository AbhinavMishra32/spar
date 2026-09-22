import { describe,expect,it } from "vitest";
import { AgentTelemetry } from "./agentTelemetry.js";
import type { LocalStore } from "./store.js";
import type { AgentTraceSink } from "./devLangSmith.js";

describe("durable agent telemetry",()=>{
  it("sequences controller events without persisting token deltas",()=>{
    const queued:Array<{kind:string;payload:Record<string,unknown>}>=[];
    const exported:Array<{kind:string;payload:Record<string,unknown>}>=[];
    const store={queueAgentTelemetry:(kind:string,payload:Record<string,unknown>)=>queued.push({kind,payload})} as unknown as LocalStore;
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
    telemetry.finish("11111111-1111-4111-a111-111111111111",{text:"done",finishReason:"stop",usage:{inputTokens:3,outputTokens:1}});
    expect(queued.map((item)=>item.kind)).toEqual(["agent-run-start","agent-trace-event","agent-trace-event","agent-run-finish"]);
    expect(queued.slice(1,3).map((item)=>item.payload.sequence)).toEqual([0,1]);
    expect((queued[2]!.payload.payload as Record<string,unknown>).state).toBe("start");
    expect(exported.map((item)=>item.kind)).toEqual(["start","record","record","finish"]);
    expect(exported[0]!.payload.startedAt).toEqual(expect.any(String));
  });
});
