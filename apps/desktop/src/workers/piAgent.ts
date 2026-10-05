import { Agent, type AgentTool, type AgentToolResult } from "@earendil-works/pi-agent-core";
import { completeSimple, streamSimple } from "@earendil-works/pi-ai/compat";
import type { AssistantMessage, AssistantMessageEvent, Message, SimpleStreamOptions } from "@earendil-works/pi-ai";
import { isContextOverflow } from "@earendil-works/pi-ai/utils/overflow";
import { agentToolSchemas } from "./agentTools.js";
import { piFastModeOptions, piModelFor, piReasoningSummaryForApi, piTransportForApi, piUsage, type PiProviderInput } from "./piProvider.js";
import type { NormalizedAgentStreamPart } from "./agentStream.js";
import type { TelemetryContext } from "@earendil-works/pi-telemetry";

/** Pi owns the native assistant/tool conversation. Spar yields after each
 * model request so it can deliver learner steering, watch for silence, stop on
 * request and record telemetry; the coach decides everything else. */

/**
 * Spar's tools, as pi executes them.
 *
 * `parameters` is the JSON Schema the model is shown, byte-identical to what
 * Mastra sent — agentTools.test.ts holds the captured original. pi validates
 * against it directly: `validateToolArguments` only treats a schema as typebox
 * when it carries typebox's own symbol, and falls back to plain JSON Schema
 * otherwise, which is what this is.
 */
export function piAgentTools(
  allowed: (name: string) => boolean,
  call: (name: string, input: unknown) => Promise<unknown>,
): AgentTool[] {
  return Object.entries(agentToolSchemas())
    .filter(([name]) => allowed(name))
    .map(([name, tool]) => ({
      name,
      label: name,
      description: tool.description,
      parameters: tool.inputSchema as AgentTool["parameters"],
      /* Runs after pi has validated, and does what zod did on top of
         validating: fills in a `.default()` the model left out. Falls back to
         the raw arguments rather than throwing, because pi has already
         accepted them against the same schema — a disagreement here would
         reject a call the contract allows. */
      prepareArguments: (args: unknown) => { try { return tool.parse(args) as never; } catch { return args as never; } },
      async execute(_toolCallId, params): Promise<AgentToolResult<unknown>> {
        const value = await call(name, params);
        /* Exactly what the model saw before: Mastra handed the AI SDK a JSON
           tool output, and the adapter turned it back into this one string on
           the way to pi. Same string, one translation fewer. */
        return { content: [{ type: "text", text: typeof value === "string" ? value : JSON.stringify(value) }], details: value };
      },
    }));
}

/**
 * The coach, pointed at the provider the learner connected: the same transport
 * pin for the ChatGPT subscription route, the same reasoning directive, the same
 * headers. The system prompt and the tool list are set once for the turn.
 */
export function createTrainingAgent(input: PiProviderInput, systemPrompt: string, telemetryContext?: TelemetryContext): Agent {
  const transport = piTransportForApi(input.api);
  const reasoningSummary = piReasoningSummaryForApi(input.api);
  return new Agent({
    initialState: { systemPrompt, model: piModelFor(input), tools: [], messages: [] },
    convertToLlm: (messages) => messages as Message[],
    streamFn: (model, context, options) => streamSimple(model, context, {
      ...options,
      ...(telemetryContext ? { telemetryContext } : {}),
      apiKey: input.apiKey,
      ...(transport ? { transport } : {}),
      ...(input.headers ? { headers: input.headers } : {}),
      ...(input.reasoningEffort && input.reasoningEffort !== "off" ? { reasoning: input.reasoningEffort } : {}),
      ...(reasoningSummary ? { reasoningSummary } : {}),
      ...(input.cacheKey ? { sessionId: input.cacheKey } : {}),
      ...piFastModeOptions(input),
    } as SimpleStreamOptions),
    /* One call at a time: a challenge build and a notebook write racing each
       other would each read state the other is about to change. */
    toolExecution: "sequential",
    /* Yield after each model request (and the tools it called) so the host can
       deliver steering, restart the idle clock and record the step. continue()
       resumes the same native conversation without replaying anything. */
    finishTurn: () => ({ action: "end" }),
  });
}

/** Whether the turn has said anything yet. pi keeps the system prompt as a
 *  message of its own, so an unstarted conversation is not an empty list. */
export function conversationStarted(agent: Agent): boolean {
  return agent.state.messages.some((message) => (message.role as string) !== "system");
}

/** Advance the conversation one model request. The first request carries the
 *  journey and the turn's event; a later one carries a message only when there
 *  is something new to say (learner steering, a correction). */
export async function advanceTrainingConversation(agent: Agent, initialPrompt: string, message?: string): Promise<void> {
  if (!conversationStarted(agent)) await agent.prompt(initialPrompt);
  else if (message) await agent.prompt(message);
  else await agent.continue();
}

/**
 * Whether the turn came back because the prompt did not fit.
 *
 * Worth having pi answer rather than Spar: providers do not agree on how they
 * say this, and several do not say it at all — some accept the oversized
 * request and answer from a truncated prompt, which is only visible as usage
 * exceeding the window, and one reports it as a length stop with no output.
 * pi carries all of that, keyed on the model's own context window.
 */
export function turnOverflowed(message: AssistantMessage | null | undefined, input: PiProviderInput): boolean {
  return message ? isContextOverflow(message, piModelFor(input).contextWindow) : false;
}

/** What a rejected call said, for the retry to quote. pi puts the complaint in
 *  the result's content, which is also what the model was shown. */
export function toolErrorText(result: unknown): string {
  const content = (result as { content?: unknown } | null)?.content;
  if (!Array.isArray(content)) return "";
  return content.flatMap((part) => (part as { type?: string; text?: string }).type === "text" ? [(part as { text?: string }).text ?? ""] : []).join(" ").trim();
}

/** A provider sometimes prints a tool invocation into assistant prose instead
 * of emitting a native tool call. This is protocol syntax, not learner intent. */
export function toolCallSpill(text: string, toolNames: Iterable<string>): string | null {
  const marker = text.indexOf("to=functions.");
  if (marker < 0) return null;
  const invocation = text.slice(marker);
  for (const name of toolNames) {
    if (invocation.startsWith(`to=functions.${name}`)) return name;
  }
  return "unknown";
}

/**
 * One provider event, in the vocabulary the transcript already speaks.
 *
 * The renderer's parts have not changed; only where they come from has. They
 * used to be Mastra stream parts put back together by `normalizeAgentStreamPart`
 * after two translations. These are pi's own events, which is the vocabulary
 * the adapter was translating *from* — so text and reasoning arrive whole
 * rather than being recovered from whichever field the wrapper used.
 */
export function normalizePiAgentEvent(event: AssistantMessageEvent): NormalizedAgentStreamPart | null {
  switch (event.type) {
    case "text_delta": return { type: "text", text: event.delta };
    case "thinking_start": return { type: "reasoning", text: "", phase: "start" };
    case "thinking_delta": return { type: "reasoning", text: event.delta };
    case "thinking_end": return { type: "reasoning", text: "", phase: "end" };
    case "toolcall_start": return { type: "status", text: "", detail: draftingStatus(toolNameAt(event.partial, event.contentIndex)) };
    case "toolcall_end": return { type: "status", text: "", detail: "tool-input-end" };
    /* Not the tool failing — the turn failing. A tool that rejects its
       arguments is reported separately, by the loop, with the fault text the
       retry quotes back. */
    case "error": return { type: "error", text: providerError(event) };
    default: return null;
  }
}

function toolNameAt(message: AssistantMessage, index: number): string {
  const content = message.content[index];
  return content?.type === "toolCall" ? content.name : "";
}

function draftingStatus(toolName: string): string {
  if (toolName === "set_challenge") return "Writing the challenge brief";
  return toolName ? `Preparing ${toolName.replaceAll("_", " ")}` : "Preparing the next action";
}

function providerError(event: Extract<AssistantMessageEvent, { type: "error" }>): string {
  const message = event.error?.errorMessage ?? "The model provider returned an unknown error.";
  return message.replace(/sk-[A-Za-z0-9_-]{8,}/g, "[redacted]").slice(0, 1_000);
}

/**
 * One tool-free completion: a system prompt, one message, one answer.
 *
 * The complexity checkpoint and the session suggester are both this shape, and
 * both used to build a whole Mastra agent to get it — an agent with no tools,
 * one step, and a stream drained only for its final text. This is the same
 * request without the apparatus.
 */
export async function piCompleteText(input: PiProviderInput, systemPrompt: string, message: string, signal: AbortSignal, timedOut: string, recordUsage?: (usage: ReturnType<typeof piUsage>) => void, onText?: (delta: string) => void, onActivity?: () => void): Promise<string> {
  const transport = piTransportForApi(input.api);
  const context = {
    systemPrompt,
    messages: [{ role: "user" as const, content: [{ type: "text" as const, text: message }], timestamp: Date.now() }],
  };
  const options = {
    apiKey: input.apiKey,
    signal,
    ...(transport ? { transport } : {}),
    ...(input.headers ? { headers: input.headers } : {}),
    ...(input.reasoningEffort && input.reasoningEffort !== "off" ? { reasoning: input.reasoningEffort } : {}),
    ...(input.cacheKey ? { sessionId: input.cacheKey } : {}),
    ...piFastModeOptions(input),
  } as SimpleStreamOptions;
  /* Streamed when someone is watching the answer arrive — the private challenge
     reviewer and repairs draw it live — or when the caller is watching for
     silence rather than for a deadline: every stream event, thinking included,
     is proof the provider is still working. A plain request otherwise. */
  let result: AssistantMessage;
  try {
    if (onText || onActivity) {
      const stream = streamSimple(piModelFor(input), context, options);
      for await (const event of stream) {
        onActivity?.();
        if (event.type === "text_delta") onText?.(event.delta);
      }
      result = await stream.result();
    } else {
      result = await completeSimple(piModelFor(input), context, options);
    }
  } catch (error) {
    if (signal.aborted) throw abortError(signal, timedOut);
    throw error;
  }
  recordUsage?.(piUsage(result.usage));
  /* pi reports a failed or cancelled request in the message rather than by
     throwing, so the caller's wording has to be raised here. Which wording
     depends on who aborted: the signal can merge the learner's Stop with an
     idle watchdog, and a Stop must not be reported as the provider going quiet. */
  if (result.stopReason === "aborted") throw abortError(signal, timedOut);
  if (result.stopReason === "error") throw new Error(result.errorMessage ?? "The model provider returned an unknown error.");
  return result.content.flatMap((part) => (part.type === "text" ? [part.text] : [])).join("");
}

/** The reason the signal carries when it has one, else the caller's timeout
 *  wording. `AbortSignal.any` keeps the reason of whichever source fired. */
function abortError(signal: AbortSignal, timedOut: string): Error {
  return signal.aborted && signal.reason instanceof Error ? signal.reason : new Error(timedOut);
}

/**
 * A provider stream that dropped rather than failed: the connection closed or
 * reset mid-answer. pi surfaces undici's "terminated" and the socket errors as
 * the message text, so this is a match on that text.
 */
export function droppedStream(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /\bterminated\b|socket hang up|ECONNRESET|ECONNREFUSED|ETIMEDOUT|EPIPE|ENOTFOUND|EAI_AGAIN|UND_ERR|fetch failed|network (?:error|connection)|other side closed|premature close|stream (?:ended|closed|disconnected)|connection (?:reset|closed|lost|error)/i.test(message);
}

/**
 * Run one private completion, and run it once more if its stream dropped.
 *
 * A dropped connection says nothing about the request, so a single retry is
 * cheaper than failing a whole challenge build over it. Nothing is retried once
 * the signal has fired — the learner's Stop and the idle watchdog both mean
 * stop — and a second drop is reported as it is. `onRetry` lets the caller
 * discard what the first attempt had streamed.
 */
export async function retryDroppedStream<T>(attempt: () => Promise<T>, signal: AbortSignal, onRetry?: (error: unknown) => void): Promise<T> {
  try {
    return await attempt();
  } catch (error) {
    if (signal.aborted || !droppedStream(error)) throw error;
    onRetry?.(error);
    return attempt();
  }
}
