type ConversationMessage = { role: "learner" | "agent" | "system"; body: string };

const REVISION_REQUEST = /\b(?:too\s+(?:hard|dif{1,2}icult)|make\s+(?:it|this|the\s+(?:challenge|question))\s+(?:easier|simpler)|(?:change|replace|simplify|adapt)\s+(?:it|this|the\s+(?:challenge|question))|(?:an?\s+)?(?:easier|simpler)\s+(?:challenge|question))\b/i;
const CONFIRMATION = /^(?:do it|yes|yeah|yep|go ahead|please do|change it)$/i;

/**
 * State-changing learner language is routed before the model runs. The model
 * still designs the replacement, but it cannot reinterpret an explicit
 * revision request as ordinary chat and skip the mutation.
 */
export function requestsChallengeRevision(message: string, recentConversation: ConversationMessage[]): boolean {
  const normalized = message.trim();
  if (REVISION_REQUEST.test(normalized)) return true;
  if (!CONFIRMATION.test(normalized)) return false;
  return recentConversation
    .filter((item) => item.role === "learner")
    .slice(-4)
    .some((item) => REVISION_REQUEST.test(item.body.trim()));
}
