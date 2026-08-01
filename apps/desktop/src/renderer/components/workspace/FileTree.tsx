import { useMemo } from "react";
import { FileCode2, FileText, FlaskConical, FolderOpen, Lock } from "lucide-react";
import type { ActiveQuestion } from "@spar/domain";
import { cn } from "@/lib/utils";

type Entry = ActiveQuestion["files"][number];
type Group = { directory: string; files: Entry[] };

function iconFor(path: string) {
  if (/\.(test|spec)\.[cm]?[jt]sx?$/.test(path) || path.includes("/test")) return FlaskConical;
  if (path.endsWith(".md") || path.endsWith(".txt")) return FileText;
  return FileCode2;
}

function directoryOf(path: string): string {
  const index = path.lastIndexOf("/");
  return index < 0 ? "" : path.slice(0, index);
}

function baseName(path: string): string {
  const index = path.lastIndexOf("/");
  return index < 0 ? path : path.slice(index + 1);
}

/**
 * Files grouped by directory. Challenges are small enough that a flat grouped
 * list reads better than a collapsible tree — every file stays one click away.
 */
export function FileTree({
  files,
  activePath,
  onSelect,
  className,
}: {
  files: Entry[];
  activePath: string;
  onSelect(path: string): void;
  className?: string;
}) {
  const groups = useMemo<Group[]>(() => {
    const byDirectory = new Map<string, Entry[]>();
    for (const file of files) {
      const directory = directoryOf(file.path);
      byDirectory.set(directory, [...(byDirectory.get(directory) ?? []), file]);
    }
    return [...byDirectory.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([directory, entries]) => ({ directory, files: entries }));
  }, [files]);

  return (
    <div className={cn("space-y-1.5", className)}>
      {groups.map((group) => (
        <div key={group.directory || "/"}>
          <div className="flex h-6 items-center gap-1.5 px-1.5 text-ui text-muted-foreground">
            <FolderOpen className="size-3.5 shrink-0" />
            <span className="min-w-0 truncate">{group.directory || "challenge"}</span>
          </div>
          <div className="space-y-px">
            {group.files.map((file) => {
              const Icon = iconFor(file.path);
              const selected = activePath === file.path;
              return (
                <button
                  key={file.path}
                  className={cn(
                    "flex h-6 w-full items-center gap-1.5 rounded-md pl-5 pr-1.5 text-left text-ui transition-colors",
                    selected
                      ? "bg-[var(--sidebar-accent-active)] text-foreground"
                      : "text-foreground/75 hover:bg-[var(--sidebar-accent)]",
                  )}
                  onClick={() => onSelect(file.path)}
                  title={file.path}
                  type="button"
                >
                  <Icon className="size-3.5 shrink-0 text-muted-foreground" />
                  <span className="min-w-0 flex-1 truncate">{baseName(file.path)}</span>
                  {file.readOnly && <Lock className="size-3 shrink-0 text-muted-foreground/60" />}
                </button>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}
