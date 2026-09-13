import { describe, expect, it } from "vitest";
import { closeOff } from "./ToolDetail";

/**
 * The worker caps a stored payload at 16k, so the long results — an attempt's
 * whole event log above all — reach the renderer as valid JSON with the end
 * sawn off. A view handed nothing back from that cannot tell "the tool returned
 * nothing" from "I could not read this", and said the first out loud.
 */
describe("a payload that was cut off", () => {
  it("closes the brackets that were open at the last value that finished", () => {
    const whole = JSON.stringify({ events: [{ id: "a" }, { id: "b" }, { id: "c" }] });
    const cut = whole.slice(0, whole.indexOf('{"id":"c"') + 6);
    expect(JSON.parse(closeOff(cut))).toEqual({ events: [{ id: "a" }, { id: "b" }] });
  });

  it("is not fooled by a bracket inside a string", () => {
    const whole = JSON.stringify({ files: [{ text: "if x: y[0] = {1}" }, { text: "second" }] });
    expect(JSON.parse(closeOff(`${whole.slice(0, whole.length - 12)}`))).toEqual({ files: [{ text: "if x: y[0] = {1}" }] });
  });

  it("leaves whole JSON exactly as it found it", () => {
    const whole = JSON.stringify({ events: [], files: [{ path: "a.py", text: "pass" }] });
    expect(closeOff(whole)).toBe(whole);
  });
});
