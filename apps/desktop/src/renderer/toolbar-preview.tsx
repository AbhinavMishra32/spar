import { ProblemStatement } from "./components/workspace/ProblemStatement";
import { createRoot } from "react-dom/client";
import type { ChallengeSource } from "@spar/domain";
import { ChallengeActions } from "./components/workspace/ChallengeActions";
import { TooltipProvider } from "./components/ui/tooltip";
import { Button } from "./components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "./components/ui/dialog";
import { Languages } from "lucide-react";
import { TracksPage } from "./components/pages/TracksPage";
import type { BootstrapData } from "../shared/api";
import { Markdown } from "./components/agent/Markdown";
import "./theme.css";

/* A harness for looking at the challenge toolbar's actions in a browser, without
   Electron. Not shipped; it is here for the same reason harness.html is. */

const source = {
  source: "leetcode", region: "global", slug: "search-in-a-binary-search-tree", externalId: "700", displayId: "700", url: "", difficulty: "easy",
  languageSlug: "python3", languages: ["cpp", "java", "python", "javascript", "typescript", "go", "rust", "swift", "ruby", "c"],
  remoteJudge: true, scratchRun: true, localCaseCount: 2, judge: "", entryName: "searchBST", cases: [], references: [],
} as ChallengeSource;

const startedAt = new Date(Date.now() - 76_000_000).toISOString();
const noop = () => {};
const run = (over: Partial<Parameters<typeof ChallengeActions>[0]["run"]> = {}) => ({
  engine: "local" as const, onEngine: noop, exampleCount: 4, hiddenCount: 31, running: false, submitting: false,
  graded: false, finalizing: false, disabled: false, onTest: noop, onSubmit: noop, ...over,
});

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-6 border-b border-border px-4 py-3">
      <span className="text-ui-sm text-muted-foreground">{label}</span>
      {children}
    </div>
  );
}

function Preview() {
  return (
    <TooltipProvider>
      <div className="min-h-screen bg-background">
        <Row label="LeetCode, idle"><ChallengeActions attemptLocked={false} completedAt={null} language="python" languageLocked={false} onGiveUp={noop} onLanguage={noop} onRestartTimer={noop} run={run()} source={source} startedAt={startedAt} /></Row>
        <Row label="LeetCode, testing there"><ChallengeActions attemptLocked completedAt={null} language="python" languageLocked onGiveUp={noop} onLanguage={noop} onRestartTimer={noop} run={run({ engine: "source", running: true })} source={source} startedAt={startedAt} /></Row>
        <Row label="Spar, hidden unknown"><ChallengeActions attemptLocked={false} completedAt={null} language="python" languageLocked={false} onGiveUp={noop} onLanguage={noop} onRestartTimer={noop} run={run({ hiddenCount: 0 })} source={null} startedAt={startedAt} /></Row>
        <Row label="Solved"><ChallengeActions attemptLocked completedAt={new Date().toISOString()} language="python" languageLocked onGiveUp={noop} onLanguage={noop} onRestartTimer={noop} run={run({ graded: true })} source={null} startedAt={startedAt} /></Row>
      </div>
      {location.hash === "#figure" && (
        <div className="fixed inset-0 overflow-auto bg-background p-8"><div className="mx-auto max-w-[36rem]"><Markdown source={FIGURE_MD} /></div></div>
      )}
      {location.hash === "#statement" && (
        <div className="fixed inset-0 overflow-auto bg-background p-8"><div className="mx-auto max-w-[34rem]"><ProblemStatement language="python" source={STATEMENT_MD} /></div></div>
      )}
      {location.hash === "#tracks" && (
        <div className="fixed inset-0 bg-background">
          <TracksPage busy={false} data={{ tracks: [], profile: { language: "python" } } as unknown as BootstrapData} onCreate={async () => {}} onDelete={async () => false} onOpen={async () => {}} />
        </div>
      )}
      {location.hash === "#dialog" && (
        <Dialog defaultOpen>
          <DialogContent className="sm:max-w-[24rem]">
            <DialogHeader>
              <DialogTitle>Switch to Go?</DialogTitle>
              <DialogDescription>You start from LeetCode&apos;s Go starter with a fresh timer. Your Python code stays in this attempt&apos;s history.</DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button variant="secondary">Keep Python</Button>
              <Button><Languages data-icon="inline-start" />Switch</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </TooltipProvider>
  );
}

const STATEMENT_MD = "Given the `root` of a binary tree, return the values of its left and right children as a pair.\n\n- Return `(left, right)`.\n- A missing child is `None`; an empty root returns `(None, None)`.\n\n## Examples\n\n**Example 1**\n```figure\n{\"type\":\"tree\",\"values\":[8,3,10]}\n```\nInput: `root = Node(8, Node(3), Node(10))`\nOutput: `(3, 10)`\nExplanation: The left child has value `3` and the right child has value `10`.\n**Example 2**\n```figure\n{\"type\":\"tree\",\"values\":[5,null,7]}\n```\nInput: `root = Node(5, None, Node(7))`\nOutput: `(None, 7)`\nExplanation: There is no left child, while the right child has value `7`. **Example 3**\nInput: `root = None`\nOutput: `(None, None)`";
const FIGURE_MD = "Given the `root` of a binary tree and an integer `k`, remove every leaf smaller than `k`.\n\n**Example 1**\n\n```figure\n{\"type\":\"row\",\"captions\":[\"root\",\"after pruning\"],\"items\":[{\"type\":\"tree\",\"values\":[8,3,10,1,6,null,14,null,null,4,7,13],\"removed\":[3,9]},{\"type\":\"tree\",\"values\":[8,3,10,null,6,null,14,null,7,13]}]}\n```\n\n```figure\n{\"type\":\"graph\",\"edges\":[[\"A\",\"B\",4],[\"A\",\"C\",2],[\"B\",\"C\",5],[\"B\",\"D\",10],[\"C\",\"E\",3],[\"E\",\"D\",4],[\"D\",\"F\",11],[\"E\",\"F\",7]],\"path\":[\"A\",\"C\",\"E\",\"F\"],\"good\":[\"A\",\"F\"]}\n```\n\n```figure\n{\"type\":\"list\",\"values\":[3,2,0],\"cycle\":5}\n```\n";

createRoot(document.getElementById("root")!).render(<Preview />);
