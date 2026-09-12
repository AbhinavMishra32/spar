import { createContext, useContext, useEffect, useState } from "react";
import { FilePlus2, SquareArrowOutUpRight } from "lucide-react";

import { cn } from "@/lib/utils";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

/**
 * The agent's own references, made live.
 *
 * The prompt has the agent write `[[file:hello.cpp|hello.cpp]]` and
 * `[[concept:cpp.kernel-basics|the C++ for GPU kernels card]]`, and until now
 * the transcript printed those brackets verbatim — the learner read the syntax
 * of a link rather than following one.
 *
 * A file reference resolves before it is drawn, and says something different
 * depending on the answer: one that exists opens the file, and one that does not
 * offers to create it. That second case is the useful one — the agent asks for a
 * file precisely when it does not exist yet, so "create hello.cpp" is the action
 * the sentence is actually asking for.
 */
export type MarkdownLinks = {
  /** The project's language, used to colour inline code.
   *
   *  A fenced block names its own language; an inline span cannot, so the only
   *  honest guess is the language of the project the snippet is being written
   *  about. Absent means no colouring, which is what the transcript did before
   *  and is never wrong — only plainer. */
  language?: string | undefined;
  onOpenConcept?: ((conceptId: string) => void) | undefined;
  /** Opens a web page outside the app. The renderer cannot navigate — the window
   *  denies it — so a search result is only a link where the surface around the
   *  transcript has handed it the door. Undefined leaves results unclickable
   *  rather than dead. */
  onOpenUrl?: ((url: string) => void) | undefined;
  onOpenFile?: ((path: string) => void) | undefined;
  onCreateFile?: ((path: string) => void) | undefined;
  /** Resolves whether a project-relative path is on disk. Undefined while the
   *  transcript is rendered somewhere with no project behind it. */
  checkFile?: ((path: string) => Promise<boolean>) | undefined;
};

const LinkContext = createContext<MarkdownLinks>({});

export function MarkdownLinkProvider({ children, value }: { children: React.ReactNode; value: MarkdownLinks }) {
  return <LinkContext.Provider value={value}>{children}</LinkContext.Provider>;
}

/** `[[kind:target|label]]`, with the label optional. Kept loose on the target so
 *  a concept id with dots and a path with slashes both survive. */
/** What the surrounding surface has told the transcript about itself. */
export function useMarkdownLinks(): MarkdownLinks {
  return useContext(LinkContext);
}

export const REFERENCE_PATTERN = /\[\[(concept|file):([^\]|]+?)(?:\|([^\]]*))?\]\]/;

export function parseReference(value: string): { kind: "concept" | "file"; target: string; label: string } | null {
  const match = REFERENCE_PATTERN.exec(value);
  if (!match) return null;
  const kind = match[1] as "concept" | "file";
  const target = match[2]!.trim();
  const label = (match[3] ?? "").trim() || target;
  return { kind, target, label };
}

const CHIP =
  "inline-flex items-baseline gap-1 rounded-[var(--radius-sm)] px-1 py-px font-medium underline decoration-dotted underline-offset-[3px] transition-colors outline-none";

export function Reference({ kind, target, label }: { kind: "concept" | "file"; target: string; label: string }) {
  const links = useContext(LinkContext);
  /* `undefined` until the answer is in. The link renders as plain text in that
     window rather than flickering between two different affordances. */
  const [present, setPresent] = useState<boolean | undefined>(kind === "concept" ? true : undefined);

  useEffect(() => {
    if (kind !== "file" || !links.checkFile) return;
    let alive = true;
    void links.checkFile(target).then((exists) => { if (alive) setPresent(exists); });
    return () => { alive = false; };
  }, [kind, links, target]);

  if (kind === "concept") {
    return (
      <button
        className={cn(CHIP, "text-foreground/90 hover:bg-accent hover:text-foreground")}
        onClick={() => links.onOpenConcept?.(target)}
        title="Open the concept card"
        type="button"
      >
        {label}
      </button>
    );
  }

  if (present === undefined) return <span className="font-medium">{label}</span>;

  if (present) {
    return (
      <button
        className={cn(CHIP, "text-foreground/90 hover:bg-accent hover:text-foreground")}
        onClick={() => links.onOpenFile?.(target)}
        type="button"
      >
        <SquareArrowOutUpRight className="size-3 shrink-0 self-center opacity-60" />
        {label}
      </button>
    );
  }

  /* Missing. The tooltip names the action rather than the state — "create hello.cpp" is what clicking does, and "hello.cpp does not exist" is a fact
     the learner can already see from the sentence around it. */
  return (
    <Tooltip>
      <TooltipTrigger
        className={cn(CHIP, "text-muted-foreground decoration-dashed hover:bg-accent hover:text-foreground")}
        onClick={() => links.onCreateFile?.(target)}
      >
        <FilePlus2 className="size-3 shrink-0 self-center opacity-60" />
        {label}
      </TooltipTrigger>
      <TooltipContent>
        Create <code className="font-mono">{target}</code>
      </TooltipContent>
    </Tooltip>
  );
}
