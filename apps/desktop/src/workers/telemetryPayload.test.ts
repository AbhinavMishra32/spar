import { describe,expect,it } from "vitest";
import { telemetryValue } from "./telemetryPayload.js";

describe("agent telemetry payloads",()=>{
  it("keeps nested trace detail while redacting credential-shaped fields",()=>{
    expect(telemetryValue({prompt:"full prompt",tool:{input:{answer:42}},authorization:"Bearer secret",nested:{apiKey:"sk-test"}})).toEqual({prompt:"full prompt",tool:{input:{answer:42}},authorization:"[REDACTED]",nested:{apiKey:"[REDACTED]"}});
  });
});
