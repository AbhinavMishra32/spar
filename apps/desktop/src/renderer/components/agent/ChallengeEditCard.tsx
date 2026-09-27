import { useMemo } from "react";
import { DiffCounts, LineDiffView } from "./NotebookView";

/**
 * What one `edit_challenge` call changed on the open challenge: each part it
 * touched, as a diff with the changed words marked. The learner sees the new
 * statement in the workspace already; this is the account of what moved.
 */

type Part = { part: string; path?: string; text: string };
export type ChallengeEditCall = { note: string; edits: Array<{ name: string; before: string; after: string }>; kept: string[] };

const PART_NAME: Record<string, string> = { statement: "Statement", title: "Title", starter: "Starter", reference: "Reference", visibleTests: "Visible tests" };

function record(payload: string): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(payload);
    return parsed && typeof parsed === "object" ? parsed as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

export function readChallengeEditCall(input: string, output: string): ChallengeEditCall {
  const sent = record(input), back = record(output);
  const list = (value: unknown) => (Array.isArray(value) ? value : []) as Part[];
  const before = list(back.before), after = list(back.after);
  const edits = after.map((entry) => {
    const was = before.find((candidate) => candidate.part === entry.part && candidate.path === entry.path);
    return { name: `${PART_NAME[entry.part] ?? entry.part}${entry.path ? ` · ${entry.path}` : ""}`, before: was?.text ?? "", after: entry.text };
  });
  const files = (Array.isArray(back.learnerFiles) ? back.learnerFiles : []) as Array<{ path?: string; outcome?: string }>;
  return { note: typeof sent.note === "string" ? sent.note : "", edits, kept: files.filter((file) => file.outcome === "kept").map((file) => String(file.path)) };
}

export function ChallengeEditCard({ input, output }: { input: string; output: string }) {
  const call = useMemo(() => readChallengeEditCall(input, output), [input, output]);
  if (!call.edits.length) return null;
  return (
    <div className="pb-1.5 pt-0.5">
      <div className="transcript-block min-w-0 overflow-hidden">
        {call.edits.map((edit) => (
          <div className="border-b border-border/50 last:border-b-0" key={edit.name}>
            <div className="flex min-w-0 items-center gap-2 px-3 py-1.5 text-thread-tool">
              <span className="min-w-0 flex-1 truncate text-[var(--transcript-step)]">{edit.name}</span>
              <DiffCounts after={edit.after} before={edit.before} />
            </div>
            <div className="app-scroll max-h-72 overflow-y-auto border-t border-border/40">
              <LineDiffView after={edit.after} before={edit.before} />
            </div>
          </div>
        ))}
        {call.kept.length > 0 && (
          <p className="border-t border-border/50 px-3 py-1.5 text-thread-tool text-muted-foreground">
            Your {call.kept.join(", ")} already had your changes there, so it was left as you wrote it.
          </p>
        )}
      </div>
    </div>
  );
}
