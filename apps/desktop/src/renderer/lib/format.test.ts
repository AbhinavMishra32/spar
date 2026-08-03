import { describe, expect, it } from "vitest";
import { message } from "./format";

describe("message", () => {
  /* What a rejected `sessions:create` actually looks like coming back over the
     bridge: Electron's wrapper around Zod's raw issue array. The learner used
     to be shown the whole thing. */
  it("reduces a validated IPC rejection to the sentences it is made of", () => {
    const issues = JSON.stringify([{ code: "too_small", minimum: 3, message: "String must contain at least 3 character(s)", path: ["goal"] }]);
    expect(message(new Error(`Error invoking remote method 'sessions:create': ${issues}`)))
      .toBe("String must contain at least 3 character(s)");
  });

  it("joins several issues rather than showing only the first", () => {
    const issues = JSON.stringify([{ message: "Model is required" }, { message: "Provider URL must use HTTPS" }]);
    expect(message(new Error(`Error invoking remote method 'settings:save-secret': ${issues}`)))
      .toBe("Model is required Provider URL must use HTTPS");
  });

  it("keeps an ordinary remote error intact once its wrapper is gone", () => {
    expect(message(new Error("Error invoking remote method 'sessions:open': Session not found"))).toBe("Session not found");
    expect(message(new Error("Authentication expired"))).toBe("Authentication expired");
  });

  /* Anything that merely starts with a bracket must survive untouched — the
     unwrapping is a convenience, never a filter that can eat a real message. */
  it("leaves bracketed text that is not an issue array alone", () => {
    expect(message(new Error("[worker] agent exited (1)"))).toBe("[worker] agent exited (1)");
    expect(message(new Error('["already up to date"]'))).toBe('["already up to date"]');
    expect(message("plain string")).toBe("plain string");
  });
});
