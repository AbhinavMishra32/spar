import { IconChevronLeft, IconChevronRight, IconSidebarSimpleLeftWide } from "central-icons";
import { cn } from "@/lib/utils";

/**
 * The title bar's glyphs.
 *
 * Central, at the same 1.75 stroke as every other icon in the window. Drawn at
 * 18px, a hair larger than the 16px marks elsewhere, because the title bar has
 * nothing else to give it weight.
 */
const CHROME = "size-[1.125rem]";

/** The sidebar toggle: a picture of the layout rather than of the action. */
export const SidebarGlyph = ({ className }: { className?: string | undefined }) => <IconSidebarSimpleLeftWide className={cn(CHROME, className)} />;

export const ChevronLeftGlyph = ({ className }: { className?: string | undefined }) => <IconChevronLeft className={cn(CHROME, className)} />;

export const ChevronRightGlyph = ({ className }: { className?: string | undefined }) => <IconChevronRight className={cn(CHROME, className)} />;
