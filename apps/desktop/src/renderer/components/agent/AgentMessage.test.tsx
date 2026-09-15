import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { AgentActivityStep } from "@spar/domain";

vi.mock("./RunFold", () => ({ RunFold: () => <div>Worked for</div> }));
vi.mock("./Markdown", () => ({ Markdown: ({ source }: { source: string }) => <p>{source}</p> }));
vi.mock("./ActivityRow", () => ({
  PROSE_GAP: 16, STEP_GAP: 8, ROW_GLYPH: "",
  ChallengePublished: () => <div>Published problem card</div>,
  RunFailure: () => null, SolveRead: () => null, ToolRow: () => null,
}));
import { AgentMessage } from "./AgentThread";

const activity: AgentActivityStep[] = [{ kind: "tool", text: "", seconds: 0, tool: "create_question", label: "Count evens", actionTitle: "", detail: "", ok: true, input: "{}", output: "{}" }];

describe("completed message artifacts", () => {
  it("keeps the published card before the response when work is collapsed", () => {
    const html = renderToStaticMarkup(<AgentMessage body="Try this next." activity={activity} activityCount={0} messageId="m" workedMs={1000} />);
    expect(html).toContain("Published problem card");
    expect(html.indexOf("Published problem card")).toBeLessThan(html.indexOf("Try this next."));
  });
  it("does not show a card for rejected creation", () => {
    const failed = activity.map(step => ({ ...step, ok: false })) as AgentActivityStep[];
    const html = renderToStaticMarkup(<AgentMessage body="Could not create it." activity={failed} activityCount={0} messageId="m" workedMs={1000} />);
    expect(html).not.toContain("Published problem card");
  });
});
