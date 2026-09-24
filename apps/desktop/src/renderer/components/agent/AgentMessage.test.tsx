import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { AgentActivityStep } from "@spar/domain";

vi.mock("./RunFold", () => ({ RunFold: () => <div>Worked for</div> }));
vi.mock("./Markdown", () => ({ Markdown: ({ source }: { source: string }) => <p>{source}</p> }));
vi.mock("./ActivityRow", () => ({
  FINAL_GAP: 16, PROSE_GAP: 16, STEP_GAP: 8, ROW_GLYPH: "",
  ChallengePublished: () => <div>Published problem card</div>,
  RunFailure: () => null, SolveRead: () => null, ToolRow: () => null,
}));
import { TooltipProvider } from "@/components/ui/tooltip";
import { AgentMessage, relativeMessageTime, responseTime } from "./AgentThread";

const activity: AgentActivityStep[] = [{ kind: "tool", text: "", seconds: 0, tool: "create_question", label: "Count evens", actionTitle: "", detail: "", ok: true, input: "{}", output: "{}", stages: [] }];

describe("completed message artifacts", () => {
  it("keeps the published card before the response when work is collapsed", () => {
    const html = renderToStaticMarkup(<TooltipProvider><AgentMessage body="Try this next." activity={activity} activityCount={0} messageId="m" workedMs={1000} /></TooltipProvider>);
    expect(html).toContain("Published problem card");
    expect(html.indexOf("Published problem card")).toBeLessThan(html.indexOf("Try this next."));
  });
  it("does not show a card for rejected creation", () => {
    const failed = activity.map(step => ({ ...step, ok: false })) as AgentActivityStep[];
    const html = renderToStaticMarkup(<TooltipProvider><AgentMessage body="Could not create it." activity={failed} activityCount={0} messageId="m" workedMs={1000} /></TooltipProvider>);
    expect(html).not.toContain("Published problem card");
  });
});

describe("response timestamps", () => {
  const now = new Date(2026, 8, 16, 18).getTime();
  it("shows only clock time for agent responses", () => {
    expect(responseTime(new Date(2026, 8, 14, 22, 32).getTime())).toBe("10:32 PM");
    expect(responseTime("invalid")).toBe("");
  });
  it("shows elapsed time for learner responses", () => {
    expect(relativeMessageTime(now - 2 * 60_000, now)).toBe("2 min ago");
    expect(relativeMessageTime(now - 60 * 60_000, now)).toBe("1 hr ago");
    expect(relativeMessageTime(now - 2 * 24 * 60 * 60_000, now)).toBe("2 days ago");
    expect(relativeMessageTime("invalid", now)).toBe("");
  });
});
