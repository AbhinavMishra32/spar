import { createRoot } from "react-dom/client";
import { ChallengeEmblem } from "./components/workspace/ChallengeEmblem";
import "./theme.css";

/* Throwaway: every stone kind across a few topics, at the sizes the app uses. */
const DIFFICULTIES = ["foundation", "developing", "proficient", "advanced"] as const;
const TOPICS = ["trees", "graphs", "strings", "arrays", "dynamic-programming", "hashing"];

function Wall() {
  if (location.hash === "#dark") document.documentElement.classList.add("dark");
  return (
    <div className="min-h-screen bg-background p-8 text-foreground">
      {DIFFICULTIES.map((difficulty) => (
        <div className="mb-8" key={difficulty}>
          <p className="mb-3 text-ui text-muted-foreground">{difficulty}</p>
          <div className="flex flex-wrap items-end gap-6">
            {TOPICS.map((topic, index) => (
              <ChallengeEmblem animated={false} key={topic} question={{ id: `q-${difficulty}-${topic}`, difficulty, ordinal: index * 3 + 2, concepts: [{ slug: topic, parentSlug: null }] }} size={56} />
            ))}
            <ChallengeEmblem question={{ id: `big-${difficulty}`, difficulty, ordinal: 12, concepts: [{ slug: "trees", parentSlug: null }] }} numbered={false} size={132} />
            <div className="flex items-center gap-3 rounded-xl border border-border p-3">
              <ChallengeEmblem animated={false} question={{ id: `row-${difficulty}`, difficulty, ordinal: 12, concepts: [{ slug: "graphs", parentSlug: null, title: "Graphs" }], title: "Node Children Pair", lastOutcome: "passed" }} size={40} />
              <div><p className="text-content font-semibold">Node Children Pair</p><p className="text-ui text-muted-foreground">Tree traversal</p></div>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

createRoot(document.getElementById("root")!).render(<Wall />);
