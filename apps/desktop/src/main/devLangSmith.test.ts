import { describe, expect, it } from "vitest";
import { DevLangSmithTraceSink } from "./devLangSmith.js";

const environment = {
  NODE_ENV: "development",
  LANGSMITH_TRACING: "true",
  LANGSMITH_ENDPOINT: "https://api.smith.langchain.com",
  LANGSMITH_API_KEY: "test-key",
  LANGSMITH_PROJECT: "spar-dev",
};

describe("development LangSmith export", () => {
  it("exports immediately without waiting for Spar cloud sync", async () => {
    const bodies: Array<{ post: Array<Record<string, unknown>>; patch: Array<Record<string, unknown>> }> = [];
    const request = (async (_input: string | URL | Request, init?: RequestInit) => {
      bodies.push(JSON.parse(String(init?.body)) as typeof bodies[number]);
      return new Response(null, { status: 202 });
    }) as typeof fetch;
    const sink = new DevLangSmithTraceSink(request, environment);
    const start = { runId:"11111111-1111-4111-a111-111111111111",sessionId:"22222222-2222-4222-a222-222222222222",provider:"openai",model:"gpt-test",turnKind:"learner-message",input:{message:"hello"},appVersion:"0.6.10",startedAt:"2026-09-22T12:00:00.000Z" };

    sink.start(start);
    sink.record({ id:"event-1",runId:start.runId,sequence:0,kind:"tool",name:"read_attempt",callId:"call-1",level:"DEFAULT",payload:{state:"start",input:{attemptId:"a1"}},occurredAt:"2026-09-22T12:00:01.000Z" });
    sink.record({ id:"event-2",runId:start.runId,sequence:1,kind:"tool",name:"read_attempt",callId:"call-1",level:"DEFAULT",payload:{state:"end",output:{ok:true}},occurredAt:"2026-09-22T12:00:02.000Z" });
    sink.finish({ id:start.runId,status:"completed",output:{text:"done"},eventCount:2,latencyMs:3000,error:null,completedAt:"2026-09-22T12:00:03.000Z" });
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(bodies).toHaveLength(4);
    expect(bodies[0]!.post[0]).toMatchObject({ id:start.runId,project_name:"spar-dev",tags:expect.arrayContaining(["spar-development"]) });
    expect(bodies[0]!.post[0]!.dotted_order).toMatch(/^20260922T120000\d{6}Z[0-9a-f-]{36}$/);
    expect(String(bodies[0]!.post[0]!.dotted_order).split("Z").at(-1)).toBe(start.runId);
    expect(bodies[1]!.post[0]).toMatchObject({ name:"read_attempt",run_type:"tool",parent_run_id:start.runId });
    expect(String(bodies[1]!.post[0]!.dotted_order).split("Z").at(-1)).toBe(bodies[1]!.post[0]!.id);
    expect(bodies[2]!.patch[0]).toMatchObject({ name:"read_attempt",outputs:{ok:true} });
    expect(bodies[3]!.patch[0]).toMatchObject({ id:start.runId,outputs:{text:"done"} });
  });

  it("is disabled outside development", () => {
    expect(new DevLangSmithTraceSink(fetch, { ...environment, NODE_ENV:"production" }).configured()).toBe(false);
  });

  it("exports a reviewer verdict as a searchable child run", async () => {
    const bodies: Array<{ post: Array<Record<string, unknown>>; patch: Array<Record<string, unknown>> }> = [];
    const request = (async (_input: string | URL | Request, init?: RequestInit) => {
      bodies.push(JSON.parse(String(init?.body)) as typeof bodies[number]);
      return new Response(null, { status: 202 });
    }) as typeof fetch;
    const sink = new DevLangSmithTraceSink(request, environment);
    const runId="11111111-1111-4111-a111-111111111111";
    sink.start({runId,sessionId:"22222222-2222-4222-a222-222222222222",provider:"openai",model:"gpt-test",turnKind:"learner-message",input:{message:"new question"},appVersion:"0.6.10",startedAt:"2026-09-22T12:00:00.000Z"});
    sink.record({id:"review-event",runId,sequence:0,kind:"event",name:"challenge-fit-verdict",callId:"review-1",level:"DEFAULT",payload:{parentCallId:"question-1",attributes:{pass:1,verdict:"revise",reason:"Previously solved",candidateTitle:"Next Greater Positions"}},occurredAt:"2026-09-22T12:00:01.000Z"});
    await new Promise((resolve)=>setTimeout(resolve,0));
    expect(bodies[1]!.post[0]).toMatchObject({name:"challenge-fit-verdict",parent_run_id:runId,outputs:{attributes:{verdict:"revise",reason:"Previously solved",candidateTitle:"Next Greater Positions"}}});
  });

  it("keeps private generations beneath their tool with stable span identity and order", async () => {
    const bodies: Array<{ post: Array<Record<string, unknown>>; patch: Array<Record<string, unknown>> }> = [];
    const request = (async (_input: string | URL | Request, init?: RequestInit) => {
      bodies.push(JSON.parse(String(init?.body)) as typeof bodies[number]);
      return new Response(null, { status: 202 });
    }) as typeof fetch;
    const sink = new DevLangSmithTraceSink(request, environment);
    const runId="11111111-1111-4111-a111-111111111111";
    const start={runId,sessionId:"22222222-2222-4222-a222-222222222222",provider:"openai",model:"gpt-test",turnKind:"learner-message",input:{message:"new question"},appVersion:"0.6.10",startedAt:"2026-09-22T12:00:00.000Z"};
    sink.start(start);
    sink.record({id:"tool-start",runId,sequence:0,kind:"tool",name:"create_question",callId:"question-1",level:"DEFAULT",payload:{state:"start",input:{title:"Histogram"}},occurredAt:"2026-09-22T12:00:01.000Z"});
    sink.record({id:"review-start",runId,sequence:1,kind:"generation",name:"private-fit-review",callId:"review-1",level:"DEFAULT",payload:{state:"start",parentCallId:"question-1",input:{candidate:"Histogram"}},occurredAt:"2026-09-22T12:00:02.000Z"});
    sink.record({id:"review-end",runId,sequence:2,kind:"generation",name:"private-fit-review",callId:"review-1",level:"DEFAULT",payload:{state:"end",parentCallId:"question-1",output:{verdict:"accept"}},occurredAt:"2026-09-22T12:00:03.000Z"});
    sink.record({id:"tool-end",runId,sequence:3,kind:"tool",name:"create_question",callId:"question-1",level:"DEFAULT",payload:{state:"end",output:{status:"playable"}},occurredAt:"2026-09-22T12:00:04.000Z"});
    sink.finish({id:runId,status:"completed",output:{text:"done"},eventCount:4,latencyMs:5000,error:null,completedAt:"2026-09-22T12:00:05.000Z"});
    await new Promise((resolve)=>setTimeout(resolve,0));
    const tool=bodies[1]!.post[0]!;
    const review=bodies[2]!.post[0]!;
    expect(review).toMatchObject({parent_run_id:tool.id,execution_order:3,child_execution_order:3});
    expect(String(review.dotted_order).startsWith(`${String(tool.dotted_order)}.`)).toBe(true);
    expect(bodies[3]!.patch[0]).not.toHaveProperty("inputs");
    expect(bodies[3]!.patch[0]).toMatchObject({id:review.id,dotted_order:review.dotted_order,start_time:review.start_time});
    expect(bodies[4]!.patch[0]).toMatchObject({id:tool.id,dotted_order:tool.dotted_order,start_time:tool.start_time,child_execution_order:3});
    expect(bodies[5]!.patch[0]).toMatchObject({id:runId,child_execution_order:3});
  });
});
