import { prepareCompaction, serializeConversation, type AgentMessage } from "@earendil-works/pi-agent-core";
import type { Message } from "@earendil-works/pi-ai";
import { estimateContextTokens } from "@earendil-works/pi-ai/utils/estimate";
import { piCompleteText } from "./piAgent.js";
import type { PiProviderInput } from "./piProvider.js";

/*
 * The coach's conversation in a session, kept between turns.
 *
 * A turn used to start a new conversation: the system prompt, the whole
 * journey rebuilt from the store, and the message. Everything the coach did
 * the turn before (what it read, what it reasoned, what it tried) was gone,
 * and the one part of the request that changed every time was the part the
 * prompt cache would otherwise have served. Now a session has one
 * conversation, saved after every turn and continued by the next: the record
 * goes in once, later turns add only what changed, and when it grows too long
 * the older part is summarised and the record put back in full.
 */

/** Tokens held back for the reply and the summary request, and the recent
 *  stretch kept word for word when the rest is summarised. pi's defaults. */
export const COMPACTION = { reserveTokens: 16_384, keepRecentTokens: 20_000 } as const;
/** Past this the conversation is summarised even when the window would take
 *  more: recall degrades with length well before the window is full, and a
 *  coach has to remember what the learner said an hour ago. */
const COMPACT_CEILING = 160_000;

/** The size at which a conversation is compacted on this model. */
export function compactionThreshold(contextWindow: number): number {
  return Math.max(COMPACTION.keepRecentTokens * 2, Math.min(contextWindow - COMPACTION.reserveTokens, COMPACT_CEILING));
}

/** How much of the window the conversation takes, from the provider's own
 *  usage on the last reply plus an estimate for what came after it. */
export function conversationTokens(messages: readonly AgentMessage[]): number {
  return estimateContextTokens(messages.filter((message) => message.role !== "system") as Message[]).tokens;
}

/** What is saved: the conversation without pi's leading system message, which
 *  is rebuilt from the current prompt and tools when it is restored. */
export function savedConversation(messages: readonly AgentMessage[]): AgentMessage[] {
  return messages.filter((message) => message.role !== "system");
}

/** The summary request: pi's checkpoint idea, written for a coaching session. */
const SUMMARY_SYSTEM = "You summarise a coaching conversation so the coach can continue it after the older part is removed. Do not continue the conversation or answer anything in it; write only the summary.";

const SUMMARY_FORMAT = `Summarise the conversation above as a checkpoint the coach will continue from. Use this format:

## The learner
What they said about themselves, their goals and how they want to be taught, close to their own words.

## What happened
Each challenge in this conversation by title and id, how it went, and what their code showed; lessons and explanations given.

## Where things stand
The misconception or gap being worked on, the hints already given and what they did with them, and the open challenge if there is one.

## Open threads
What the coach said it would do next, and anything promised, asked for or unresolved.

## Exact details
Ids, numbers, names and quoted words that would be hard to recover.

Keep the learner's words close to verbatim and condense the coach's own reasoning. The learner's record (notebooks, challenges, abilities, settings) is given to the coach again in full after this summary, so do not copy it: keep what only the conversation has. If an earlier summary appears in the conversation, fold it in.`;

/**
 * Summarise the older part of the conversation and keep the recent part.
 *
 * pi chooses where to cut (never between a tool call and its result); the
 * summary is one request on the coach's own provider, and comes back as a user
 * message at the head of what is kept. Null when there is too little to
 * compact or the request failed: the caller carries on with what it has.
 */
export async function compactConversation(messages: readonly AgentMessage[], provider: PiProviderInput, signal: AbortSignal): Promise<{ messages: AgentMessage[]; tokensBefore: number } | null> {
  const body = savedConversation(messages);
  const entries = body.map((message, index) => ({ type: "message" as const, id: String(index), parentId: index ? String(index - 1) : null, seq: index, timestamp: Number(message.timestamp) || Date.now(), message }));
  const prepared = prepareCompaction(entries, { enabled: true, ...COMPACTION });
  if (!prepared.ok || !prepared.value) return null;
  const older = [...prepared.value.messagesToSummarize, ...prepared.value.turnPrefixMessages];
  if (!older.length) return null;
  try {
    const conversation = serializeConversation(older as Message[]);
    const summary = await piCompleteText({ ...provider, reasoningEffort: "low" }, SUMMARY_SYSTEM, `<conversation>\n${conversation}\n</conversation>\n\n${SUMMARY_FORMAT}`, signal, "Summarising the conversation stopped: the provider went silent.");
    if (!summary.trim()) return null;
    const head: AgentMessage = {
      role: "user",
      content: [{ type: "text", text: `The conversation before this point was compacted into the following summary:\n\n<summary>\n${summary.trim()}\n</summary>` }],
      timestamp: Date.now(),
    };
    return { messages: [head, ...prepared.value.retainedTail], tokensBefore: prepared.value.tokensBefore };
  } catch {
    return null;
  }
}
