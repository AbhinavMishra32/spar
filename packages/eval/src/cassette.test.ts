import { afterEach, describe, expect, it, vi } from "vitest";
import { cassetteKey, installCassette, type Cassette } from "./cassette.js";

const body = (model: string, prompt: string) => JSON.stringify({ model, messages: [{ role: "user", content: prompt }] });
const URL_ = "https://api.example.com/v1/messages";

let deck: { restore(): void } | null = null;
afterEach(() => { deck?.restore(); deck = null; });

describe("the key", () => {
  it("is the same question asked twice", () => {
    expect(cassetteKey("POST", URL_, body("m", "hi"))).toBe(cassetteKey("post", URL_, body("m", "hi")));
  });

  it("changes when the prompt does, which is the whole point", () => {
    expect(cassetteKey("POST", URL_, body("m", "hi"))).not.toBe(cassetteKey("POST", URL_, body("m", "hello")));
  });

  it("changes when the model does", () => {
    expect(cassetteKey("POST", URL_, body("a", "hi"))).not.toBe(cassetteKey("POST", URL_, body("b", "hi")));
  });

  it("ignores the query string, which providers use for things that are not the question", () => {
    expect(cassetteKey("POST", `${URL_}?beta=true`, body("m", "hi"))).toBe(cassetteKey("POST", URL_, body("m", "hi")));
  });

  it("ignores a per-call field that says nothing about what was asked", () => {
    const withUser = JSON.stringify({ model: "m", messages: [], user: "abc" });
    const without = JSON.stringify({ model: "m", messages: [] });
    expect(cassetteKey("POST", URL_, withUser)).toBe(cassetteKey("POST", URL_, without));
  });
});

describe("recording", () => {
  it("captures the response and hands back an identical one", async () => {
    const real = vi.fn(async () => new Response("hello world", { status: 200, headers: { "content-type": "text/plain" } }));
    globalThis.fetch = real as unknown as typeof fetch;
    deck = installCassette({ mode: "record" });

    const response = await globalThis.fetch(URL_, { method: "POST", body: body("m", "hi") });
    expect(await response.text()).toBe("hello world");
    expect(real).toHaveBeenCalledTimes(1);
    expect((deck as ReturnType<typeof installCassette>).cassette().entries).toHaveLength(1);
  });

  it("keeps no credential out of the recording", async () => {
    globalThis.fetch = (async () => new Response("ok", { headers: { "set-cookie": "session=secret", "x-api-key": "sk-live-1", "content-type": "text/plain" } })) as unknown as typeof fetch;
    deck = installCassette({ mode: "record" });
    await globalThis.fetch(URL_, { method: "POST", body: body("m", "hi") });
    const headers = (deck as ReturnType<typeof installCassette>).cassette().entries[0]!.headers;
    expect(Object.keys(headers).map((key) => key.toLowerCase())).toEqual(["content-type"]);
  });
});

describe("replay", () => {
  const recorded = (): Cassette => ({
    version: 1,
    entries: [{
      key: cassetteKey("POST", URL_, body("m", "hi")),
      method: "POST", url: URL_, requestBody: body("m", "hi"),
      status: 200, statusText: "OK", headers: { "content-type": "text/event-stream" },
      body: "data: {\"a\":1}\n\ndata: {\"b\":2}\n\n", durationMs: 1234, recordedAt: "2026-01-01T00:00:00.000Z",
    }],
  });

  it("answers from the cassette without reaching the network", async () => {
    const real = vi.fn(async () => new Response("live"));
    globalThis.fetch = real as unknown as typeof fetch;
    deck = installCassette({ cassette: recorded(), mode: "replay" });

    const response = await globalThis.fetch(URL_, { method: "POST", body: body("m", "hi") });
    expect(await response.text()).toBe("data: {\"a\":1}\n\ndata: {\"b\":2}\n\n");
    expect(real).not.toHaveBeenCalled();
    expect((deck as ReturnType<typeof installCassette>).hits).toBe(1);
  });

  it("refuses to invent an answer to a question it has not been asked", async () => {
    globalThis.fetch = (async () => new Response("live")) as unknown as typeof fetch;
    deck = installCassette({ cassette: recorded(), mode: "replay" });
    await expect(globalThis.fetch(URL_, { method: "POST", body: body("m", "something else") })).rejects.toThrow(/No recorded response/);
    expect((deck as ReturnType<typeof installCassette>).misses).toHaveLength(1);
  });

  it("fills the gaps in auto, and leaves what it already had alone", async () => {
    const real = vi.fn(async () => new Response("fresh", { headers: { "content-type": "text/plain" } }));
    globalThis.fetch = real as unknown as typeof fetch;
    deck = installCassette({ cassette: recorded(), mode: "auto" });

    await globalThis.fetch(URL_, { method: "POST", body: body("m", "hi") });
    await globalThis.fetch(URL_, { method: "POST", body: body("m", "new") });
    expect(real).toHaveBeenCalledTimes(1);
    const tape = deck as ReturnType<typeof installCassette>;
    expect(tape.hits).toBe(1);
    expect(tape.recorded).toBe(1);
    expect(tape.cassette().entries).toHaveLength(2);
  });

  it("delivers a stream in event-sized pieces, as the parser on the other end expects", async () => {
    globalThis.fetch = (async () => new Response("live")) as unknown as typeof fetch;
    deck = installCassette({ cassette: recorded(), mode: "replay" });
    const response = await globalThis.fetch(URL_, { method: "POST", body: body("m", "hi") });
    const reader = response.body!.getReader();
    const chunks: string[] = [];
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(new TextDecoder().decode(value));
    }
    expect(chunks).toEqual(["data: {\"a\":1}\n\n", "data: {\"b\":2}\n\n"]);
  });

  it("puts the real fetch back", async () => {
    const real = (async () => new Response("live")) as unknown as typeof fetch;
    globalThis.fetch = real;
    const tape = installCassette({ mode: "record" });
    expect(globalThis.fetch).not.toBe(real);
    tape.restore();
    expect(globalThis.fetch).toBe(real);
  });
});
