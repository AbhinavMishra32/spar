import { createRoot } from "react-dom/client";
import { AskUserQuestion } from "./components/agent/AskUserQuestion";
import "./theme.css";

const request = {
  id: "11111111-1111-4111-8111-111111111111",
  questions: [{
    header: "Async error handling today",
    question: "How do you currently handle errors in async TypeScript code, and what does 'failures cascade' look like for you in practice?",
    options: [
      { label: "Try/catch at each layer, but errors still bubble up in surprising ways" },
      { label: "Comfortable with promises — I want a cleaner structure so one failure stays contained" },
      { label: "Confident with result-style handling — I want the edge cases hardened" },
    ],
    multiple: false,
    custom: true,
  }],
};

createRoot(document.getElementById("root")!).render(
  <div className="min-h-screen bg-background p-10">
    <div className="mx-auto max-w-[42rem]">
      <AskUserQuestion busy={false} onSubmit={(answer) => console.log(answer)} request={request} />
    </div>
  </div>,
);
