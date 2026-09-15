import { describe, expect, it } from "vitest";
import { unreconciledOptimisticMessages } from "./optimisticMessages";

describe("optimistic learner messages", () => {
  it("shows a submitted reply before persistence returns", () => {
    const pending = [{ id: "local", body: "Use a smaller example", createdAt: 2_000 }];
    expect(unreconciledOptimisticMessages([], pending)).toEqual(pending);
  });

  it("reconciles the local bubble with the newly persisted reply", () => {
    const pending = [{ id: "local", body: "Use a smaller example", createdAt: 2_000 }];
    const messages = [{ role: "learner", body: "Use a smaller example", createdAt: new Date(2_100).toISOString() }];
    expect(unreconciledOptimisticMessages(messages, pending)).toEqual([]);
  });

  it("does not mistake an old identical reply for the new one", () => {
    const pending = [{ id: "local", body: "yes", createdAt: 20_000 }];
    const messages = [{ role: "learner", body: "yes", createdAt: new Date(2_000).toISOString() }];
    expect(unreconciledOptimisticMessages(messages, pending)).toEqual(pending);
  });
});
