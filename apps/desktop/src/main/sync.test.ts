import { describe, expect, it } from "vitest";
import { CloudSyncService, route } from "./sync.js";
import type { AuthService } from "./auth.js";
import type { LocalStore } from "./store.js";

describe("background sync failures", () => {
  it("reports offline instead of rejecting when credentials cannot be read", async () => {
    const states: string[] = [];
    const auth = { accessToken: async () => { throw new Error("credential store unavailable"); } } as unknown as AuthService;
    const sync = new CloudSyncService({} as LocalStore, auth, "https://api.test", (state) => states.push(state));

    await expect(sync.flush()).resolves.toBeUndefined();
    expect(states).toEqual(["offline"]);
  });
});

/* The outbox is a table of `kind` strings and JSON payloads, and `route` is the
   only thing that turns one into a request. A kind that maps to the wrong path is
   a silent data-loss bug: `flush` acknowledges any 2xx, so a payload posted to a
   route that ignores it disappears from the queue having achieved nothing. */
describe("outbox routing", () => {
  it("sends the onboarding profile to the profile route", () => {
    const profile = { name: "Abhinav", experience: "working", focus: [], weakness: "", language: "typescript", completedAt: new Date().toISOString() };
    expect(route("profile-save", profile)).toEqual({ path: "/v1/profile", method: "PUT", body: profile });
  });

  it("sends the versioned adaptive projection as one account document", () => {
    const state = { version: 1, tracks: [], abilityState: [] };
    expect(route("learning-state", state)).toEqual({ path: "/v1/learning-state", method: "PUT", body: state });
  });

  it("batches transcript messages under the session they belong to", () => {
    const payload = { sessionId: "s1", messages: [{ id: "m1", role: "agent", body: "Hello", createdAt: "2026-01-01T00:00:00.000Z", activity: [] }] };
    expect(route("agent-message", payload)).toEqual({ path: "/v1/agent-messages", method: "POST", body: payload });
  });

  it("sends only agent-invented concepts, as a batch", () => {
    const payload = { concepts: [{ slug: "window-invariant-restoration", title: "Window invariant restoration", kind: "skill", parentSlug: null, description: "" }] };
    expect(route("concept-create", payload)).toEqual({ path: "/v1/concepts", method: "POST", body: payload });
  });

  /* Filing is a partial patch on the session, and the session id belongs in the
     path rather than the body — a `sessionId` left in the patch would be read as a
     field to update. */
  it("patches session filing without leaking the id into the body", () => {
    expect(route("session-flags", { sessionId: "s1", pinnedAt: "2026-01-01T00:00:00.000Z" })).toEqual({
      path: "/v1/sessions/s1",
      method: "PATCH",
      body: { pinnedAt: "2026-01-01T00:00:00.000Z" },
    });
  });

  /* Null is how unpinning is said, so it has to survive the trip. An `undefined`
     here would be dropped by JSON.stringify and the pin would never clear. */
  it("keeps a null so unpinning and unarchiving mean something", () => {
    expect(route("session-flags", { sessionId: "s1", archivedAt: null })).toEqual({ path: "/v1/sessions/s1", method: "PATCH", body: { archivedAt: null } });
  });

  it("still routes the kinds that shipped before restore existed", () => {
    expect(route("session-create", { sessionId: "s1", goal: "g", title: "t" })).toMatchObject({ path: "/v1/sessions", method: "POST" });
    expect(route("session-rename", { sessionId: "s1", title: "t" })).toMatchObject({ path: "/v1/sessions/s1", method: "PATCH" });
    expect(route("session-delete", { sessionId: "s1" })).toMatchObject({ path: "/v1/sessions/s1", method: "DELETE" });
    expect(route("question-create", { sessionId: "s1" })).toMatchObject({ path: "/v1/challenges", method: "POST" });
    expect(route("ability-upsert", { id: "a1" })).toMatchObject({ path: "/v1/abilities", method: "POST" });
    expect(route("checkpoint", { sessionId: "s1", version: 3 })).toMatchObject({ path: "/v1/sessions/s1/checkpoints/3", method: "PUT" });
  });

  /* An attempt event is posted as a batch of one with the sequence it expects to
     follow, which is what lets the server reject an out-of-order push. */
  it("posts an attempt event with the sequence the server should expect", () => {
    expect(route("attempt-event", { attemptId: "a1", sequence: 4 })).toEqual({
      path: "/v1/attempts/a1/events",
      method: "POST",
      body: { attemptId: "a1", expectedSequence: 4, events: [{ attemptId: "a1", sequence: 4 }] },
    });
  });

  /* A row left by an older build must drain rather than wedge the queue: `flush`
     acknowledges an unroutable item and moves on, and that depends on null here. */
  it("declines a kind it does not know", () => {
    expect(route("something-a-future-build-invented", {})).toBeNull();
  });
});
