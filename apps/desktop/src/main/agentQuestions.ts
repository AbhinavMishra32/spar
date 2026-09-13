import type { AskUserQuestionInput, AskUserQuestionRequest } from "@spar/domain";
import type { LocalStore } from "./store.js";

type WaitingQuestion = {
  request: AskUserQuestionRequest;
  resolve(value: QuestionAnswer): void;
};

export type QuestionAnswer = {
  pending: false;
  status: "answered" | "cancelled";
  request: AskUserQuestionRequest;
  answer?: string;
};

/**
 * Keeps an agent tool call open while its question is on screen.
 *
 * The durable question still belongs to LocalStore. This class owns only the
 * live promise connecting that row to the worker turn which asked it. Keeping
 * the promise open is the important part: the learner's answer becomes the
 * result of that same tool call, so the Pi session continues as one turn rather
 * than starting a second run with a synthetic learner message.
 */
export class AgentQuestions {
  private readonly waiting = new Map<string, WaitingQuestion>();

  constructor(private readonly store: LocalStore) {}

  ask(sessionId: string, input: AskUserQuestionInput): Promise<QuestionAnswer> | QuestionAnswer {
    const asked = this.store.setPendingIntake(sessionId, input);
    if (asked.status === "answered") {
      return { pending: false, status: "answered", request: asked.request, answer: asked.answer ?? "" };
    }
    if (this.waiting.has(sessionId)) throw new Error("This session is already waiting for an answer.");
    return new Promise<QuestionAnswer>((resolve) => this.waiting.set(sessionId, { request: asked.request, resolve }));
  }

  answer(sessionId: string, answer: string): { resumed: boolean; request: AskUserQuestionRequest } {
    const request = this.store.pendingIntake(sessionId);
    if (!request) throw new Error("That question is no longer waiting for an answer.");
    this.store.answerIntake(sessionId, answer);
    const waiting = this.waiting.get(sessionId);
    if (waiting) {
      this.waiting.delete(sessionId);
      waiting.resolve({ pending: false, status: "answered", request: waiting.request, answer });
    }
    return { resumed: Boolean(waiting), request };
  }

  cancel(sessionId: string) {
    const waiting = this.waiting.get(sessionId);
    if (!waiting) return;
    this.waiting.delete(sessionId);
    waiting.resolve({ pending: false, status: "cancelled", request: waiting.request });
  }
}
