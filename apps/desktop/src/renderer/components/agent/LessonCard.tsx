import { Tabs } from "radix-ui";
import { useState } from "react";
import { BookOpen, ChevronDown, Maximize2 } from "lucide-react";
import { motion, useReducedMotion } from "motion/react";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { ArtifactCard, ArtifactCardRow } from "./ArtifactCard";
import { useThreadArrival } from "./ActivityRow";
import { LESSON_MORPH, lessonLayoutId, readTaughtLesson } from "./taughtLesson";
import type { ToolPart } from "./agentRun";
import { useMarkdownLinks } from "./MarkdownLinks";
import { LessonPages, LessonTabs } from "./LessonContent";
import { useLesson } from "./useLesson";

const CARD_ACTION = "grid size-6 shrink-0 place-items-center rounded-[var(--radius-md)] text-muted-foreground outline-none transition-[color,background-color,opacity] duration-150 hover:bg-[var(--color-background-elevated-secondary)] hover:text-foreground focus-visible:ring-1 focus-visible:ring-ring";

export function LessonCard({ part }: { part: ToolPart }) {
  const arrival = useThreadArrival(true);
  const lesson = readTaughtLesson(part);
  const links = useMarkdownLinks();
  const [expanded, setExpanded] = useState(false);
  const reading = useLesson(lesson.id);
  const reduced = useReducedMotion();
  const lifted = Boolean(lesson.id && links.openLessonId === lesson.id);
  return (
    <Collapsible open={expanded} onOpenChange={setExpanded}>
      <Tabs.Root value={String(reading.page)} onValueChange={(value) => { reading.setPage(Number(value)); setExpanded(true); }}>
      <ArtifactCard {...arrival}
        className={`group/lesson ${expanded ? "" : "hover:bg-[var(--surface-primary)]"}`}
        {...(!reduced && lesson.id ? { layoutId: lessonLayoutId(lesson.id) } : {})}
        transition={reduced ? { duration: 0 } : { ...LESSON_MORPH, opacity: { duration: 0.18 } }}
        style={{ borderRadius: "1.4rem" }}
        inert={lifted}
      >
        <ArtifactCardRow icon={<BookOpen className="size-4 text-[var(--transcript-step-mark)]" />}>
          <div className="min-w-0 flex-1 pr-14">
            <CollapsibleTrigger disabled={!lesson.id} className="block w-full truncate rounded-md text-left text-thread font-semibold text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring">{lesson.title}</CollapsibleTrigger>
            <p className="mt-0.5 truncate text-thread-tool text-muted-foreground">
              {lesson.pages.length > 0 ? `${lesson.pages.length} ${lesson.pages.length === 1 ? "page" : "pages"}` : "Lesson"}
            </p>
          </div>
        </ArtifactCardRow>
        <div className="absolute right-1.5 top-1.5 flex items-center gap-0.5">
          {lesson.id && links.onOpenLesson && <button type="button" aria-label={`Open ${lesson.title} in a modal`} onClick={() => links.onOpenLesson?.(lesson.id!)} className={CARD_ACTION}><Maximize2 className="size-3.5" /></button>}
          <CollapsibleTrigger disabled={!lesson.id} aria-label={expanded ? "Collapse lesson" : "Expand lesson"} className={CARD_ACTION}>
            <motion.span animate={{ rotate: expanded ? 180 : 0 }} transition={reduced ? { duration: 0 } : LESSON_MORPH}><ChevronDown className="size-3.5" /></motion.span>
          </CollapsibleTrigger>
        </div>
        <CollapsibleContent expandDuration={0.26}>
          <div className="border-t border-border/50">
            {reading.status === "ready" && reading.lesson ? <div className="flex max-h-[32rem] flex-col"><LessonPages lesson={reading.lesson} className="px-5 py-5" /></div> : <p role="status" className="px-5 py-5 text-thread text-muted-foreground">{reading.status === "missing" ? "This lesson could not be loaded." : "Opening the lesson…"}</p>}
          </div>
        </CollapsibleContent>
      </ArtifactCard>
      <LessonTabs lesson={reading.lesson ?? { pages: lesson.pages.map((title) => ({ title })) }} onSelect={() => setExpanded(true)} />
      </Tabs.Root>
    </Collapsible>
  );
}
