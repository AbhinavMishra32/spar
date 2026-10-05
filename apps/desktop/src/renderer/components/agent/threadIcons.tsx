/**
 * The transcript's marks.
 *
 * Central's round outline, drawn at a 1.75 stroke (see theme.css): firm enough at 16px to hold its
 * shape beside 14px text, and the same family as every other icon in the
 * app, so the thread no longer reads as a separate drawing. The row owns the
 * colour (`currentColor`), so a mark dims and brightens with its label instead
 * of being lit separately.
 *
 * The export names are the thread's vocabulary, not Central's — a row asks for
 * "the edit mark", and which glyph that is gets decided here, once.
 */
import type { ReactNode } from "react";
import type { CentralIconBaseProps } from "central-icons";
import {
  IconArrowCornerDownRight,
  IconBook,
  IconChevronRight,
  IconCircleInfo,
  IconCircleX,
  IconCode,
  IconConsoleSimple,
  IconExclamationCircle,
  IconFileText,
  IconFolder1,
  IconFolderOpen,
  IconGlobe,
  IconHistory,
  IconLightningBolt,
  IconListBullets,
  IconMagicBook,
  IconMagnifyingGlass,
  IconPencilLine,
  IconPlayCircle,
  IconProcessor,
  IconPuzzle,
  IconQuestionmarkCircle,
  IconSparkle as CentralSparkle,
  IconSuitcase,
  IconCheckmark1,
  IconLightbulbGlow,
  IconLoadingCircle,
} from "central-icons";

type Props = CentralIconBaseProps;

export const IconSearch = (p: Props) => <IconMagnifyingGlass {...p} />;
export { IconGlobe };
export const IconFile = (p: Props) => <IconFileText {...p} />;
/** Code — the mark on the step that reads what the learner wrote. */
export { IconCode };
export const IconEdit = (p: Props) => <IconPencilLine {...p} />;
export const IconFolder = (p: Props) => <IconFolderOpen {...p} />;
export const IconTerminal = (p: Props) => <IconConsoleSimple {...p} />;
export const IconChip = (p: Props) => <IconProcessor {...p} />;
export const IconDossier = (p: Props) => <IconSuitcase {...p} />;
export { IconBook };
export const IconList = (p: Props) => <IconListBullets {...p} />;
export const IconCheck = (p: Props) => <IconCheckmark1 {...p} />;
export const IconQuestion = (p: Props) => <IconQuestionmarkCircle {...p} />;
export const IconAlert = (p: Props) => <IconExclamationCircle {...p} />;
export const IconInfo = (p: Props) => <IconCircleInfo {...p} />;
export { IconCircleX };
/** A folder with nothing to say about being open. Used where the row is naming
 *  a directory rather than reporting a read of one. */
export const IconFolderPlain = (p: Props) => <IconFolder1 {...p} />;
/** The elbow that marks a line as belonging to the row above it. */
export const IconCornerArrow = (p: Props) => <IconArrowCornerDownRight {...p} />;
export const IconLightning = (p: Props) => <IconLightningBolt {...p} />;
export { IconHistory };
export const IconSparkle = (p: Props) => <CentralSparkle {...p} />;
export { IconPuzzle };
export const IconPlay = (p: Props) => <IconPlayCircle {...p} />;
export { IconChevronRight };
/** The model reasoning. */
export const IconThinking = (p: Props) => <IconLightbulbGlow {...p} />;
/** Waiting on the model itself, before any step has a glyph of its own. */
export const IconWaiting = (p: Props) => <IconLoadingCircle {...p} />;

/**
 * A step with nothing more specific to say.
 *
 * Not a wrench, and not a tick. A tool the transcript has no mark for is not a
 * tool that failed and not one that did anything the reader can name from a
 * glyph, so it gets the smallest possible statement that something happened —
 * which also keeps a run of unfamiliar tools from reading as a column of
 * identical hardware.
 */
export const IconDot = ({ className }: { className?: string }) => <span className={className ?? "size-1.5 rounded-full bg-[currentColor] opacity-35"} />;

/** Skill — a book with a spark on it: instructions the agent reached for, not a
 *  file of the learner's. */
export const IconSkill = (p: Props) => <IconMagicBook {...p} />;

/**
 * A mark while its step is still under way: the step's own glyph, breathing.
 *
 * The orbs this replaces said "something is running" in a different visual
 * language from every settled row. The glyph itself says what is running, and
 * the slow pulse says that it is — so when the step lands the mark simply stops
 * moving instead of turning into something else.
 */
export function LiveMark({ children, label }: { children: ReactNode; label: string }) {
  return (
    <span aria-label={label} className="inline-flex animate-pulse motion-reduce:animate-none" role="img">
      {children}
    </span>
  );
}
