import { createRoot } from "react-dom/client";
import type { AskUserQuestionRequest } from "@spar/domain";
import { AskUserQuestion } from "./components/agent/AskUserQuestion";
import "./theme.css";

/* A harness for looking at the agent's question card in a browser, without
   Electron or a live turn. Not shipped; here for the same reason harness.html is. */

if (new URLSearchParams(location.search).get("theme") !== "light") document.documentElement.classList.add("dark");

const single: AskUserQuestionRequest = {
  id: "q1",
  questions: [{
    header: "Graphics context",
    question: "Which real graphics task should anchor the monotonic-stack work?",
    options: [
      { label: "2D visibility/occlusion from a camera sweep" },
      { label: "Finding nearest occluding geometry along a scanline" },
      { label: "Another specific graphics use case (describe it)" },
    ],
    multiple: false,
    custom: true,
  }],
};

const multi: AskUserQuestionRequest = {
  id: "q2",
  questions: [
    { ...single.questions[0]!, header: "Topics", question: "Which of these have you used in production?", multiple: true },
    { ...single.questions[0]!, header: "Depth" },
  ],
};

createRoot(document.getElementById("root")!).render(
  <div className="flex min-h-screen flex-col items-center gap-10 bg-background px-6 py-16">
    <div className="w-full max-w-[46rem]"><AskUserQuestion busy={false} onSubmit={() => {}} request={single} /></div>
    <div className="w-full max-w-[46rem]"><AskUserQuestion busy={false} onSubmit={() => {}} request={multi} /></div>
  </div>,
);
