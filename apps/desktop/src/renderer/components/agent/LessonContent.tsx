import { cn } from "@/lib/utils";
import { Tabs } from "radix-ui";
import { motion, useReducedMotion } from "motion/react";
import { ExternalLink } from "lucide-react";
import type { StoredLesson } from "../../../shared/api";
import { ArtifactCard, ArtifactCardRow } from "./ArtifactCard";
import { Markdown } from "./Markdown";
import { useMarkdownLinks } from "./MarkdownLinks";

export function LessonContent({ lesson, page, onPage }: { lesson: StoredLesson; page: number; onPage(page: number): void }) {
  return (
    <Tabs.Root value={String(page)} onValueChange={(value) => onPage(Number(value))} className="flex min-h-0 min-w-0 flex-1 flex-col">
      <LessonPages lesson={lesson} className="px-5 py-4" />
      <div className="shrink-0 px-5 pb-4 pt-1"><LessonTabs lesson={lesson} /></div>
    </Tabs.Root>
  );
}

export function LessonPages({ lesson, className }: { lesson: StoredLesson; className?: string }) {
  const reduced = useReducedMotion();
  return <>
      {lesson.pages.map((item, index) => <Tabs.Content key={index} value={String(index)} className={cn("app-scroll min-h-0 flex-1 overflow-y-auto px-3 py-3 outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring", className)}>
        <motion.div initial={reduced ? false : { opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: reduced ? 0 : 0.18 }}>
          <Markdown source={item.body} />
          {item.takeaway && <p className="mt-4 border-l-2 border-[var(--brand)] pl-3 text-thread leading-[1.6] text-[var(--transcript-step-strong)]">{item.takeaway}</p>}
          {index === lesson.pages.length - 1 && lesson.references.length > 0 && <References lesson={lesson} />}
        </motion.div>
      </Tabs.Content>)}
  </>;
}

export function LessonTabs({ lesson, onSelect }: { lesson: { pages: readonly { title: string }[] }; onSelect?: () => void }) {
  return (
      <Tabs.List aria-label="Lesson pages" className="app-scroll flex shrink-0 gap-2 overflow-x-auto px-1 pb-1 pt-3">
        {lesson.pages.map((item, index) => <Tabs.Trigger asChild key={index} value={String(index)} onClick={onSelect}
          onFocus={(event) => event.currentTarget.scrollIntoView({ block: "nearest", inline: "nearest", behavior: "instant" })}
        >
          <ArtifactCard style={{ borderRadius: "0.75rem" }} className="w-max max-w-[16rem] shrink-0 cursor-default text-muted-foreground outline-none transition-colors hover:bg-[var(--surface-primary)] focus-visible:ring-2 focus-visible:ring-ring data-[state=active]:bg-[var(--code-background)] data-[state=active]:text-foreground ">
            <ArtifactCardRow compact className="gap-2 px-2 py-1.5 pr-3" icon={<span className="font-mono text-thread tabular-nums">{index + 1}</span>}>
              <span className="min-w-0 truncate text-thread font-medium">{item.title}</span>
            </ArtifactCardRow>
          </ArtifactCard>
        </Tabs.Trigger>)}
      </Tabs.List>
  );
}

function References({ lesson }: { lesson: StoredLesson }) {
  const links = useMarkdownLinks();
  return (
    <div className="mt-6 border-t border-[var(--border-surface-strong)]/50 pt-3.5">
      <p className="mb-2 text-thread font-medium text-[var(--transcript-step-mark)]">Where to read next</p>
      <ul className="space-y-2.5">
        {lesson.references.map((reference, index) => {
          const open = reference.kind === "url" ? () => links.onOpenUrl?.(reference.url)
            : reference.kind === "concept" ? () => links.onOpenConcept?.(reference.slug)
            : reference.kind === "lesson" ? () => links.onOpenLesson?.(reference.lessonId)
            : undefined;
          const clickable = Boolean(open && (reference.kind !== "url" || links.onOpenUrl));
          return (
            <li key={index}>
              {clickable ? (
                <button className="group/ref min-w-0 text-left" onClick={open} type="button">
                  <span className="inline-flex items-baseline gap-1 font-medium text-foreground underline decoration-dotted underline-offset-[3px] group-hover/ref:text-[var(--brand)]">
                    {reference.label}
                    {reference.kind === "url" && <ExternalLink className="size-3 self-center" />}
                  </span>
                  <span className="block text-thread leading-[1.5] text-muted-foreground">{reference.note}</span>
                </button>
              ) : (
                <div className="min-w-0">
                  <span className="font-medium text-foreground">{reference.label}</span>
                  <span className="block text-thread leading-[1.5] text-muted-foreground">{reference.note}</span>
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
