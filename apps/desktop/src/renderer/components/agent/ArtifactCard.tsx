import type { ReactNode } from "react";
import { motion, type HTMLMotionProps } from "motion/react";
import { cn } from "@/lib/utils";

/** The shared transcript surface for a published challenge or lesson. */
export function ArtifactCard({ className, ...props }: HTMLMotionProps<"div">) {
  return <motion.div className={cn("transcript-block relative my-0 min-w-0 overflow-visible transition-[background-color,box-shadow] duration-100", className)} {...props} />;
}

export function ArtifactCardRow({ icon, children, compact = false, className, iconClassName }: { icon: ReactNode; children: ReactNode; compact?: boolean; className?: string; iconClassName?: string }) {
  return (
    <div className={cn("flex min-w-0 items-center", compact ? "gap-1.5 px-1.5 py-1" : "gap-2.5 px-2.5 py-1.5", className)}>
      <span className={cn("grid shrink-0 place-items-center rounded-[var(--radius-md)] bg-[var(--color-background-elevated-secondary)] ring-[0.5px] ring-[var(--border-surface-strong)]", compact ? "size-5" : "size-7", iconClassName)}>{icon}</span>
      {children}
    </div>
  );
}
