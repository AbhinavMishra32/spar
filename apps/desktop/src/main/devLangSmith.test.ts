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
    expect(bodies[0]!.post[0]!.dotted_order).toMatch(/^20260922T120000\d{6}Z[0-9a-f]{32}$/);
    expect(bodies[1]!.post[0]).toMatchObject({ name:"read_attempt",run_type:"tool",parent_run_id:start.runId });
    expect(bodies[2]!.patch[0]).toMatchObject({ name:"read_attempt",outputs:{ok:true} });
    expect(bodies[3]!.patch[0]).toMatchObject({ id:start.runId,outputs:{text:"done"} });
  });

  it("is disabled outside development", () => {
    expect(new DevLangSmithTraceSink(fetch, { ...environment, NODE_ENV:"production" }).configured()).toBe(false);
  });
});
