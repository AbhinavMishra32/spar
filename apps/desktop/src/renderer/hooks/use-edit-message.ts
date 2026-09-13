import { useCallback, useMemo } from "react";
import type { SessionDetail } from "@spar/domain";
import { message } from "@/lib/format";

/**
 * Rewriting something you already said.
 *
 * Offered for the learner's own messages, and only while nothing is running:
 * the turn being rewound is the one still writing into the transcript, and the
 * main process refuses it for the same reason. Everything from that message
 * onward leaves the conversation and the rewritten one is answered in its
 * place — what the agent recorded on the way stays recorded, which is what the
 * confirmation in the thread says.
 *
 * Lives here rather than being threaded down because all three surfaces that
 * draw a transcript offer it, and none of them is the component holding the API.
 */
export function useEditMessage(detail: SessionDetail, streaming: boolean, onRefresh: () => Promise<void>, onError: (value: string) => void) {
  const undoable = useMemo(
    () => new Set(streaming ? [] : detail.messages.filter((item) => item.role === "learner").map((item) => item.id)),
    [detail.messages, streaming],
  );

  const edit = useCallback((messageId: string, body: string) => {
    void window.spar?.editAgentMessage({ sessionId: detail.summary.id, messageId, message: body })
      .then(() => onRefresh())
      .catch((cause: unknown) => onError(message(cause)));
  }, [detail.summary.id, onError, onRefresh]);

  return { undoable, edit };
}
