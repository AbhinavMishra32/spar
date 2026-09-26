import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { ToolStage } from "../../../shared/api";
import { StageTree } from "./StageTree";

const stage = (id: string, kind: ToolStage["kind"], verb: string, state: ToolStage["state"], extra: Partial<ToolStage> = {}): ToolStage => ({ id, kind, verb, subject: "", state, startedAt: 1, endedAt: 2, ...extra });

describe("a finished build", () => {
  const build = [
    stage("stage-0", "draft", "Drafted", "done"),
    stage("stage-1", "review", "Reviewer accepted", "done", { detail: "REVIEW_REASON" }),
    stage("stage-2", "validate", "Validation failed", "failed", { detail: "FIRST_FAILURE" }),
    stage("stage-3", "repair", "Repaired", "done", { detail: "REPAIR_DETAIL" }),
    stage("stage-4", "validate", "Validation passed", "done", { runs: [{ id: "r", label: "RUN_LABEL", expect: "pass", state: "passed" }] }),
    stage("stage-5", "outcome", "Published", "done"),
  ];

  it("folds every settled stage to its line, and a failure once a later stage fixed it", () => {
    const html = renderToStaticMarkup(<StageTree stages={build} />);
    for (const verb of ["Drafted", "Reviewer accepted", "Validation failed", "Repaired", "Validation passed", "Published"]) expect(html).toContain(verb);
    for (const body of ["REVIEW_REASON", "FIRST_FAILURE", "REPAIR_DETAIL", "RUN_LABEL"]) expect(html).not.toContain(body);
  });

  it("keeps an unresolved failure open", () => {
    const html = renderToStaticMarkup(<StageTree stages={[...build.slice(0, 3), stage("stage-9", "outcome", "Not published", "failed")]} />);
    expect(html).toContain("FIRST_FAILURE");
  });

  it("tells a validate-and-repair loop as one line", () => {
    const html = renderToStaticMarkup(<StageTree stages={build} />);
    expect(html).toContain("Validation passed");
    expect(html).toContain("after 1 repair");
    expect(html).not.toContain(">Validation failed<");
  });
});
