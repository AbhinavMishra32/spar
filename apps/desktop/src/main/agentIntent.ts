type ConversationMessage = { role: "learner" | "agent" | "system"; body: string };

const REVISION_REQUEST = new RegExp([
  /too\s+(?:hard|dif{1,2}icult)/,
  /make\s+(?:it|this|the\s+(?:challenge|question))\s+(?:easier|simpler)/,
  /(?:change|replace|simplify|adapt|swap|switch)\s+(?:it|this|the\s+(?:challenge|question|problem))/,
  /(?:an?\s+)?(?:easier|simpler)\s+(?:challenge|question)/,
  /* "Just give me a LeetCode problem." Asking for a different *kind* of challenge
     is as much a revision request as asking for an easier one, and it used to
     route to ordinary chat — so nothing made the turn actually swap anything, and
     the agent answered by searching, and searching, and searching. Qualified
     deliberately: only another/different/new/real/sourced, never a bare "this
     question", so that "give me a hint on this question" stays a conversation. */
  /(?:another|a\s+different|a\s+new|a\s+real|an?\s+actual|an?\s+(?:lc|cf)|a\s+(?:leetcode|codeforces))\s+(?:\w+\s+){0,2}?(?:challenge|question|problem)/,
  /(?:give|gimme|get|set|assign|want|show)\s+me\s+(?:\w+\s+){0,3}?(?:lc|cf|leetcode|neetcode|codeforces)\b/,
  /skip\s+(?:it|this)\b/,
].map((pattern) => pattern.source).join("|"), "i");
const CONFIRMATION = /^(?:do it|yes|yeah|yep|yup|sure|ok(?:ay)?|go|go ahead|please do|change it)$/i;

/**
 * State-changing learner language is routed before the model runs. The model
 * still chooses the replacement — and with a source connected it may hand over a
 * real problem instead of writing one — but it cannot reinterpret an explicit
 * revision request as ordinary chat and skip the mutation.
 *
 * "Too hard" and "give me a real LeetCode problem instead" are the same request
 * about the same thing: the challenge in front of them is not the one they want.
 * Only the second one says which way to move.
 */
export function requestsChallengeRevision(message: string, recentConversation: ConversationMessage[]): boolean {
  const normalized = message.trim();
  /* A bare confirmation is answered from what they were confirming, and it is
     checked first because "do it" opens with an interrogative word without being
     a question. */
  if (CONFIRMATION.test(normalized)) {
    return recentConversation
      .filter((item) => item.role === "learner")
      .slice(-4)
      .some((item) => REVISION_REQUEST.test(item.body.trim()));
  }
  /* "Is this a LeetCode problem?" asks about the challenge in the same words as a
     request to be given one, and asking about a challenge must never be what
     discards it. So a question is read as the question it is, unless it also asks
     for something outright — "what now, give me another one". */
  if (INTERROGATIVE.test(normalized) && !ASKS_OUTRIGHT.test(normalized)) return false;
  return REVISION_REQUEST.test(normalized);
}

const INTERROGATIVE = /^(?:is|are|was|were|does|did|what|whats|what's|why|how|which|who|where)\b/i;
const ASKS_OUTRIGHT = /\b(?:give|gimme|set|assign|show)\s+me\b|\bi\s+(?:want|need)\b/i;
