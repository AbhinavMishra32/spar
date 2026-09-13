import { describe, expect, it } from "vitest";
import { LocalStore } from "./store.js";
import { AgentQuestions } from "./agentQuestions.js";

const question = {
  questions: [{
    header: "Focus",
    question: "What should the rewritten tests emphasize?",
    options: [{ label: "More thorough visible cases" }, { label: "Clearer failures" }],
    multiple: false,
    custom: true,
  }],
};

describe("AgentQuestions", () => {
  it("keeps the tool pending and resolves it with the learner answer", async () => {
    const store = new LocalStore(":memory:");
    try {
      const { sessionId } = store.createSession("Practise test design");
      const questions = new AgentQuestions(store);
      let settled = false;
      const waiting = Promise.resolve(questions.ask(sessionId, question)).then((value) => {
        settled = true;
        return value;
      });

      await Promise.resolve();
      expect(settled).toBe(false);
      expect(store.readSession(sessionId)?.pendingLearnerQuestion).not.toBeNull();

      expect(questions.answer(sessionId, "More thorough visible cases").resumed).toBe(true);
      await expect(waiting).resolves.toMatchObject({
        pending: false,
        status: "answered",
        answer: "More thorough visible cases",
      });
      expect(store.readSession(sessionId)?.pendingLearnerQuestion).toBeNull();
      expect(store.readSession(sessionId)?.messages).toEqual([]);
    } finally {
      store.close();
    }
  });

  it("answers a persisted question without pretending an old turn is live", () => {
    const store = new LocalStore(":memory:");
    try {
      const { sessionId } = store.createSession("Practise test design");
      store.setPendingIntake(sessionId, question);
      const questions = new AgentQuestions(store);
      expect(questions.answer(sessionId, "Clearer failures").resumed).toBe(false);
      expect(store.answeredIntake(sessionId)).toBe("Clearer failures");
    } finally {
      store.close();
    }
  });
});
