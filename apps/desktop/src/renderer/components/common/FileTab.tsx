import type { ComponentProps } from "react";
import { FileCode2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { FileGlyph } from "./LanguageGlyph";

/** The editor's file tab, shared with file previews in the thread. */
export function FileTab({ path, active, dirty = false, className, ...props }: ComponentProps<"button"> & {
  path: string;
  active: boolean;
  dirty?: boolean;
}) {
  return (
    <button
      className={cn(
        "inline-flex h-6 shrink-0 items-center gap-1.5 rounded-md px-2 text-ui transition-colors",
        active ? "bg-accent text-foreground" : "text-muted-foreground hover:text-foreground",
        className,
      )}
      title={path}
      type="button"
      {...props}
    >
      <FileGlyph className="shrink-0 opacity-80" fallback={FileCode2} path={path} />
      {path.split("/").pop()}
      {active && dirty && <span className="size-1.5 rounded-full bg-foreground/50" />}
    </button>
  );
}
