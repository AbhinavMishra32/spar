import { describe, expect, it } from "vitest";
import type { BootstrapData } from "../../../shared/api";
import { pageChrome } from "./pageChrome";

/** Only the handful of fields the chrome reads. Everything else on the
 *  bootstrap is a page's problem, and typing it out here would make the test
 *  about the schema rather than about what the toolbar claims. */
function boot(partial: Partial<BootstrapData>): BootstrapData {
  return {
    sessions: [],
    challenges: [],
    saved: [],
    abilities: [],
    tracks: [],
    activeTrack: null,
    ...partial,
  } as unknown as BootstrapData;
}

const session = (id: string, over: Record<string, unknown> = {}) =>
  ({ id, context: "training", status: "active", archivedAt: null, trackId: null, ...over }) as never;

const challenge = (id: string, over: Record<string, unknown> = {}) =>
  ({ id, sessionId: "s1", lastOutcome: null, ...over }) as never;

describe("pageChrome", () => {
  it("names Home, which has no heading of its own, and reports what is still open", () => {
    const chrome = pageChrome("home", boot({
      activeTrack: { id: "t1", title: "Graphs" } as never,
      sessions: [session("s1"), session("s2", { status: "completed" })],
    }), null);
    expect(chrome).toEqual({ title: "Home", facts: [{ value: "Graphs" }, { value: "1 session", label: "open", tone: "good" }] });
  });

  /* The pages that open with their own h1 must not be given a second name in a
     row eleven pixels above it. */
  it("leaves a page that names itself unnamed", () => {
    for (const page of ["tracks", "history", "problems", "sessions"] as const) {
      expect(pageChrome(page, boot({}), null)?.title).toBeUndefined();
    }
  });

  it("counts a Track's own sessions and challenges, not the window's", () => {
    const chrome = pageChrome("track", boot({
      activeTrack: { id: "t1", title: "Graphs", language: "python" } as never,
      sessions: [session("s1", { trackId: "t1" }), session("s2", { trackId: "t2" })],
      challenges: [challenge("c1", { sessionId: "s1" }), challenge("c2", { sessionId: "s2" })],
    }), null);
    expect(chrome?.facts).toEqual([
      { value: "1 session" },
      { value: "1 challenge" },
      { value: "Python" },
    ]);
  });

  /* A baseline session is the calibration run's bookkeeping: it appears in no
     list, so it may not appear in a count of one either. */
  it("ignores baseline sessions everywhere it counts sessions", () => {
    const data = boot({ sessions: [session("s1"), session("s2", { context: "baseline" })] });
    expect(pageChrome("sessions", data, null)?.facts[0]).toEqual({ value: "1 session" });
  });

  it("says nothing about a tally that is zero rather than drawing a zero", () => {
    expect(pageChrome("problems", boot({}), null)).toEqual({ facts: [] });
    expect(pageChrome("history", boot({}), null)?.facts).toEqual([{ value: "0 challenges" }]);
  });

  it("reports how much evidence is behind an ability, and whether it is earned", () => {
    const data = boot({ abilities: [{ id: "a1", earnedAt: null, evidenceCount: 3 } as never] });
    expect(pageChrome("ability", data, "a1")?.facts).toEqual([
      { value: "Forming" },
      { value: "3 attempts", label: "of evidence" },
    ]);
    expect(pageChrome("ability", data, "missing")).toBeNull();
  });

  /* Settings is its own window inside the window — a row of counts over it would
     be chrome over chrome. */
  it("hands Settings no chrome at all", () => {
    expect(pageChrome("settings", boot({}), null)).toBeNull();
  });
});
