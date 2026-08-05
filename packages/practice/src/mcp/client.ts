import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { PracticeGateway } from "../gateway.js";
import { createPracticeMcpServer } from "./server.js";

/**
 * Spar's own connection to the practice MCP server.
 *
 * The transport is in-memory rather than a pipe to a subprocess, and that is a
 * deliberate choice rather than a shortcut. The protocol is what earns its keep
 * here — described tools, validated arguments, a listing the host does not
 * hardcode — and none of that requires a second process. What a subprocess would
 * add is a spawn on launch, a binary to ship inside the app bundle, a lifetime to
 * manage, and a crash mode; what it would buy is isolation from code that already
 * runs in this process. So the same server module is connected two ways: over this
 * transport for Spar, and over stdio for anybody else (see `stdio.ts`).
 *
 * The returned handle is deliberately small. The host does not get the server: it
 * gets `listTools` and `call`, which is all a tool bridge should be able to do.
 */
export type PracticeMcpConnection = {
  /** The tools this server is actually offering, as it describes them. Read once
   *  at startup and again when the connection is rebuilt. */
  listTools(): Promise<Array<{ name: string; description: string }>>;
  /** Calls a tool and returns its parsed result. Throws only when the protocol
   *  itself failed — a tool that could not do its job answers with a payload. */
  call(name: string, args: Record<string, unknown>): Promise<unknown>;
  close(): Promise<void>;
};

export async function connectPracticeMcp(deps: {
  gateway: PracticeGateway;
  allowJudging?: boolean;
  onCall?: (event: { tool: string; ok: boolean; detail: string }) => void;
}): Promise<PracticeMcpConnection> {
  const server = createPracticeMcpServer(deps);
  const client = new Client({ name: "spar-desktop", version: "0.1.1" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);

  return {
    async listTools() {
      const listed = await client.listTools();
      return listed.tools.map((tool) => ({ name: tool.name, description: tool.description ?? "" }));
    },
    async call(name, args) {
      const result = await client.callTool({ name, arguments: args });
      /* Every handler answers with one text block holding JSON. Parsed here so a
         caller never has to know that, and returned raw if it is ever not JSON —
         losing a tool's answer to a parse error would be worse than passing text
         through. */
      const blocks = Array.isArray(result.content) ? result.content : [];
      const text = blocks
        .filter((block): block is { type: "text"; text: string } => (block as { type?: unknown }).type === "text")
        .map((block) => block.text)
        .join("");
      /* `isError` is never something a handler sets: a source that could not
         answer returns a payload saying so. So this is the protocol itself
         refusing — arguments that failed validation, or a tool that does not
         exist — and it has to reach the caller as a thrown error. Passing it
         through as data is how "Input validation error" ends up being read as a
         fact about a problem. */
      if (result.isError) throw new Error(text || `The practice MCP server rejected the call to ${name}.`);
      if (!text) return result.structuredContent ?? {};
      try { return JSON.parse(text); } catch { return { text }; }
    },
    async close() {
      await client.close().catch(() => undefined);
      await server.close().catch(() => undefined);
    },
  };
}
