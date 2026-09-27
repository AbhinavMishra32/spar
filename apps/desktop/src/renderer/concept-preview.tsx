import { createRoot } from "react-dom/client";
import type { ConceptDetail, ConceptEvidence, ConceptSummary } from "@spar/domain";
import type { SparApi } from "../shared/api";
import { ConceptSheet } from "./components/concepts/ConceptSheet";
import { TooltipProvider } from "./components/ui/tooltip";
import "./theme.css";

/* A harness for looking at the concept sheet in a browser, with the history a
   learner a day into binary trees would have. Not shipped. */

const ago = (hours: number) => new Date(Date.now() - hours * 3_600_000).toISOString();
let n = 0;
const uuid = () => `00000000-0000-4000-8000-${String(++n).padStart(12, "0")}`;
const session = uuid();

const concept: ConceptSummary = {
  id: uuid(), slug: "tree-structure-roles", title: "Tree structure roles", kind: "dsa", description: "",
  parentSlug: "trees", parentTitle: "Trees", childSlugs: [],
  challengeCount: 13, passedCount: 4, failedCount: 0, abandonedCount: 0, openCount: 1,
  attemptCount: 20, testRunCount: 44, replacedCount: 8, abilityCount: 6, firstSeenAt: ago(30), lastSeenAt: ago(19),
};

const row = (title: string, outcome: ConceptEvidence["outcome"], hours: number, role: "primary" | "supporting" = "primary"): ConceptEvidence => ({
  challengeId: uuid(), sessionId: session, sessionTitle: "learn binary tree from basics", title, language: "python",
  difficulty: "foundation", role, outcome, testRunCount: 3, occurredAt: ago(hours),
});

const detail: ConceptDetail = {
  concept, parent: null, children: [],
  abilities: [
    { id: uuid(), title: "Use a node's child links and values to solve a basic binary-tree question.", status: "developing" },
    { id: uuid(), title: "Read a binary-tree node and its child values", status: "independent" },
    { id: uuid(), title: "Use child links to search a binary search tree", status: "uncertain" },
    { id: uuid(), title: "Use recursion to count nodes in a binary tree", status: "independent" },
    { id: uuid(), title: "Identify a binary-tree node's direct children", status: "independent" },
    { id: uuid(), title: "Use recursion to combine values across a binary tree", status: "stale" },
  ],
  challenges: [
    row("Sum Values in a Binary Tree", "open", 19),
    row("Read a Node's Child Links", "replaced", 19),
    row("Read a Node's Child Links", "replaced", 19),
    row("Count Nodes in a Binary Tree", "passed", 23),
    row("Search a Binary Search Tree", "passed", 24, "supporting"),
    row("Find the Left Child", "passed", 26),
    row("Tree Height", "failed", 28, "supporting"),
    row("Leaf Count", "passed", 29),
  ],
};

const api = { readConcept: async () => detail } as unknown as SparApi;
if (new URLSearchParams(location.search).has("dark")) document.documentElement.classList.add("dark");

createRoot(document.getElementById("root")!).render(
  <TooltipProvider>
    <ConceptSheet api={api} onOpenChange={() => {}} onOpenSession={() => {}} onPractise={() => {}} slug={concept.slug} summaries={new Map([[concept.slug, concept]])} />
  </TooltipProvider>,
);
