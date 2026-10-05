import { describe, expect, it } from "vitest";
import { LocalStore } from "./store.js";
import { agentTurnPayload, journeySections, journeyUpdate } from "./agentTurnPayload.js";

const input = (store: LocalStore, sessionId: string, extra: Partial<Parameters<typeof agentTurnPayload>[0]> = {}) =>
  ({ store, sessionId, message: "go", turnKind: "learner-message" as const, webSearch: false, practiceSource: true, practiceSummary: null, accountId: "a", ...extra });

describe("what a turn opens with", () => {
  it("says only the sections that changed, whole, and the ones that went", () => {
    const before = [{ key: "a", text: "## A\none" }, { key: "b", text: "## B\ntwo" }, { key: "c", text: "## C\nthree" }];
    const after = [{ key: "a", text: "## A\none" }, { key: "b", text: "## B\nTWO" }, { key: "d", text: "## D\nfour" }];
    const update = journeyUpdate(before, after);
    expect(update).toMatch(/^# Update\nNow: /);
    expect(update).toContain("## B\nTWO");
    expect(update).toContain("## D\nfour");
    expect(update).not.toContain("## A");
    expect(update).toContain("No longer in the journey: C.");
    expect(journeyUpdate(before, before)).toContain("Nothing in the journey changed since your last turn.");
  });

  it("keeps a section the same while nothing in it changes, however much time passes", () => {
    const store = new LocalStore(":memory:");
    try {
      const { sessionId } = store.createSession("Heaps");
      store.addMessage(sessionId, "learner", "hi");
      const one = journeySections(input(store, sessionId), { conversation: false });
      const two = journeySections(input(store, sessionId), { conversation: false });
      expect(two).toEqual(one);
      expect(one.map((section) => section.text).join("\n")).not.toMatch(/ago\b|just now/);
      expect(one.some((section) => section.key === "conversation")).toBe(false);
    } finally { store.close(); }
  });

  it("starts a conversation from the whole journey, with the session's messages, when there is none to continue", () => {
    const store = new LocalStore(":memory:");
    try {
      const { sessionId } = store.createSession("Heaps");
      store.addMessage(sessionId, "learner", "teach me heaps");
      const payload = agentTurnPayload(input(store, sessionId, { promptRef: "v1" }));
      expect(payload.conversation).toBeNull();
      expect(payload.context).toMatch(/^# Journey\nNow: /);
      expect(payload.context).toContain("## This session so far");
      expect(payload.record).not.toContain("## This session so far");
      expect(payload.sections.length).toBeGreaterThan(3);
    } finally { store.close(); }
  });

  it("continues one started under the same prompt with only what changed, and starts over under another", () => {
    const store = new LocalStore(":memory:");
    try {
      const { sessionId } = store.createSession("Heaps");
      const first = agentTurnPayload(input(store, sessionId, { promptRef: "v1" }));
      store.saveConversation(sessionId, { promptRef: "v1", messages: [{ role: "user", content: "earlier", timestamp: 1 }], sections: first.sections });

      const same = agentTurnPayload(input(store, sessionId, { promptRef: "v1", conversation: store.readConversation(sessionId) }));
      expect(same.conversation).toEqual([{ role: "user", content: "earlier", timestamp: 1 }]);
      expect(same.context).toContain("Nothing in the journey changed since your last turn.");

      store.setTrainingTarget(sessionId, { ability: "Heap selection", specificGap: "Bounded heap", desiredEvidence: "Keeps k", avoidTesting: [] });
      const changed = agentTurnPayload(input(store, sessionId, { promptRef: "v1", conversation: store.readConversation(sessionId) }));
      expect(changed.context).toContain("## Current training target");
      expect(changed.context).not.toContain("## Track notebook");

      const other = agentTurnPayload(input(store, sessionId, { promptRef: "v2", conversation: store.readConversation(sessionId) }));
      expect(other.conversation).toBeNull();
      expect(other.context).toMatch(/^# Journey/);
    } finally { store.close(); }
  });

  it("saves the conversation per session and forgets it on a rewind or a delete", () => {
    const store = new LocalStore(":memory:");
    try {
      const { sessionId } = store.createSession("Heaps");
      const message = store.addMessage(sessionId, "learner", "first");
      store.saveConversation(sessionId, { promptRef: "v1", messages: [{ role: "user", content: "first", timestamp: 1 }], sections: [{ key: "a", text: "## A" }] });
      expect(store.readConversation(sessionId)).toMatchObject({ promptRef: "v1", sections: [{ key: "a", text: "## A" }] });
      store.rewindToMessage(sessionId, message!.id);
      expect(store.readConversation(sessionId)).toBeNull();
      store.saveConversation(sessionId, { promptRef: "v1", messages: [{ role: "user", content: "again", timestamp: 2 }], sections: [] });
      store.deleteSession(sessionId);
      expect(store.readConversation(sessionId)).toBeNull();
    } finally { store.close(); }
  });
});
