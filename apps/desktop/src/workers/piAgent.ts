import { Agent, type AgentTool, type AgentToolResult } from "@earendil-works/pi-agent-core";
import { completeSimple, streamSimple } from "@earendil-works/pi-ai/compat";
import type { AssistantMessage, AssistantMessageEvent, Message, SimpleStreamOptions } from "@earendil-works/pi-ai";
import { isContextOverflow } from "@earendil-works/pi-ai/utils/overflow";
import { agentToolSchemas } from "./agentTools.js";
import { piFastModeOptions, piModelFor, piReasoningSummaryForApi, piTransportForApi, toolChoiceFor, type PiProviderInput } from "./piProvider.js";
import type { NormalizedAgentStreamPart } from "./agentStream.js";

/**
 * Spar's agent loop, on pi's own runtime.
 *
 * What was here before went out through Mastra, which went out through an
 * AI SDK `LanguageModelV2`, which went out through an adapter back into pi.
 * Three translations for a library Spar was already calling, and each one lost
 * something on the way: the forced tool choice never survived the last hop, so
 * the phase controller's twenty-one required calls were only ever requested in
 * prose.
 *
 * The controller itself does not move. It still decides each phase, and it
 * still hands the model one prompt at a time with one set of tools — see
 * `agent.ts`. This is the plumbing under it.
 */

/** What the model may do about tools on the next request. Kept as a live
 *  reference rather than a constructor argument because pi fixes the stream
 *  options when the run starts, and Spar's controller changes this every
 *  phase — which is the entire mechanism it is built on. */
export type ToolChoiceRef = { current: unknown };

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
 * The agent, pointed at the provider the learner connected.
 *
 * `toolChoice` is read per request rather than captured, so the controller can
 * require a specific tool for one phase and leave the next one open. Everything
 * else is the request Spar was already making — the same transport pin for the
 * ChatGPT subscription route, the same reasoning directive, the same headers.
 */
export function createTrainingAgent(input: PiProviderInput, systemPrompt: string, toolChoice: ToolChoiceRef): Agent {
  const transport = piTransportForApi(input.api);
  const reasoningSummary = piReasoningSummaryForApi(input.api);
  return new Agent({
    initialState: { systemPrompt, model: piModelFor(input), tools: [], messages: [] },
    /* The transcript is already pi messages — Spar has no custom message kinds
       — so there is nothing to convert. */
    convertToLlm: (messages) => messages as Message[],
    streamFn: (model, context, options) => streamSimple(model, context, {
      ...options,
      apiKey: input.apiKey,
      ...(transport ? { transport } : {}),
      ...(input.headers ? { headers: input.headers } : {}),
      ...(input.reasoningEffort && input.reasoningEffort !== "off" ? { reasoning: input.reasoningEffort } : {}),
      /* Ask for the working, not just the chapter titles — see
         `piReasoningSummaryForApi`. */
      ...(reasoningSummary ? { reasoningSummary } : {}),
      ...piFastModeOptions(input),
      ...(toolChoice.current !== undefined ? { toolChoice: toolChoice.current as never } : {}),
    } as SimpleStreamOptions),
    /* One phase's tools run one at a time. The controller's own de-duplication
       is keyed on the phase a call was made in, and two calls racing inside one
       phase would read that cache before either had written to it. */
    toolExecution: "sequential",
    /* One turn per phase, which is what `maxSteps: 1` bought before.
       pi's loop would otherwise keep going on its own after executing tool
       calls, and the phase boundary is not a detail of the old runtime — it is
       the controller: every phase re-plans which tools are open, re-checks the
       stop signal, and restates the evidence. A loop that ran on past it would
       be a different agent with the same prompts. */
    shouldStopAfterTurn: () => true,
  });
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

/** How the controller spells a phase's tool rule for this provider. Named here
 *  so the phase loop never has to know which API family it is talking to. */
export const phaseToolChoice = (api: string, choice: "auto" | "required" | "none") =>
  toolChoiceFor(api, { type: choice } as never);

/** What a rejected call said, for the retry to quote. pi puts the complaint in
 *  the result's content, which is also what the model was shown. */
export function toolErrorText(result: unknown): string {
  const content = (result as { content?: unknown } | null)?.content;
  if (!Array.isArray(content)) return "";
  return content.flatMap((part) => (part as { type?: string; text?: string }).type === "text" ? [(part as { text?: string }).text ?? ""] : []).join(" ").trim();
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
    case "toolcall_start": return { type: "status", text: "", detail: "tool-input-start" };
    case "toolcall_end": return { type: "status", text: "", detail: "tool-input-end" };
    /* Not the tool failing — the turn failing. A tool that rejects its
       arguments is reported separately, by the loop, with the fault text the
       retry quotes back. */
    case "error": return { type: "error", text: providerError(event) };
    default: return null;
  }
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
export async function piCompleteText(input: PiProviderInput, systemPrompt: string, message: string, signal: AbortSignal, timedOut: string): Promise<string> {
  const transport = piTransportForApi(input.api);
  const result = await completeSimple(piModelFor(input), {
    systemPrompt,
    messages: [{ role: "user", content: [{ type: "text", text: message }], timestamp: Date.now() }],
  }, {
    apiKey: input.apiKey,
    signal,
    ...(transport ? { transport } : {}),
    ...(input.headers ? { headers: input.headers } : {}),
    ...(input.reasoningEffort && input.reasoningEffort !== "off" ? { reasoning: input.reasoningEffort } : {}),
    ...piFastModeOptions(input),
  } as SimpleStreamOptions);
  /* pi reports a failed or cancelled request in the message rather than by
     throwing, so the caller's own timeout wording has to be raised here — the
     learner is told the check took too long, not that a stream stopped. */
  if (result.stopReason === "aborted") throw new Error(timedOut);
  if (result.stopReason === "error") throw new Error(result.errorMessage ?? "The model provider returned an unknown error.");
  return result.content.flatMap((part) => (part.type === "text" ? [part.text] : [])).join("");
}
