import { useState, type ReactNode } from "react";
import { Check, Loader2 } from "lucide-react";
import { LANGUAGES, type ChallengeSource, type Language } from "@spar/domain";
import { cn } from "@/lib/utils";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { LANGUAGE_LABEL, LanguageGlyph } from "../common/LanguageGlyph";
import { SourceGlyph } from "../common/SourceGlyph";

/** The languages Spar builds a local example harness for. Everything else a
 *  source publishes still runs on the source's judge. Mirrors
 *  `LOCAL_FUNCTION_HARNESS` in @spar/practice. */
const LOCAL_HARNESS = new Set<Language>(["javascript", "typescript", "python", "cpp"]);
const SOURCE_NAME: Record<ChallengeSource["source"], string> = { leetcode: "LeetCode", codeforces: "Codeforces" };

/**
 * The challenge's language, as a thing that can be changed.
 *
 * Opened from the toolbar, beside Test and Submit, because the language is what
 * those two run. A sourced problem offers what its source publishes starters for;
 * a problem Spar wrote offers every language and the agent converts it. What
 * will happen is said once, above the grid, rather than on every row.
 */
export function LanguageMenu({
  language,
  source,
  disabled,
  onSelect,
  loadLanguages,
  children,
}: {
  language: Language;
  source: ChallengeSource | null | undefined;
  disabled: boolean;
  onSelect(language: Language): void;
  /** Fetches the source's languages, for a challenge mounted before they were
   *  stored on it. Called once, when the menu first opens. */
  loadLanguages?: (() => Promise<Language[]>) | undefined;
  /** The trigger. Rendered as-is, so it must be a single focusable element. */
  children: ReactNode;
}) {
  const [loaded, setLoaded] = useState<Language[] | null>(null);
  const [loading, setLoading] = useState(false);
  const stored = source?.languages?.length ? source.languages : loaded;
  const options: readonly Language[] = source ? (stored?.length ? stored : [language]) : LANGUAGES;
  const onOpenChange = (open: boolean) => {
    if (!open || !source || stored || loading || !loadLanguages) return;
    setLoading(true);
    void loadLanguages().then(setLoaded).catch(() => setLoaded([])).finally(() => setLoading(false));
  };
  const sourceName = source ? SOURCE_NAME[source.source] : "";
  const remoteOnly = (option: Language) => Boolean(source) && source?.source !== "codeforces" && !LOCAL_HARNESS.has(option);
  const anyRemoteOnly = options.some(remoteOnly);

  return (
    <DropdownMenu onOpenChange={onOpenChange}>
      <DropdownMenuTrigger asChild disabled={disabled}>{children}</DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-[17.5rem] p-1.5">
        <div className="px-1.5 pb-2 pt-1">
          <p className="text-ui font-medium text-foreground">Language</p>
          <p className="mt-0.5 text-ui-sm leading-[1.45] text-muted-foreground">
            {source
              ? <>Starts over from {sourceName}&apos;s starter.{anyRemoteOnly && <> <SourceGlyph className="inline size-3 -translate-y-px align-middle" source={source.source} /> tests on {sourceName} only.</>}</>
              : "The agent rewrites this challenge in the one you pick."}
          </p>
        </div>
        {loading && (
          <p className="flex items-center gap-1.5 px-2 pb-1.5 text-ui-sm text-muted-foreground">
            <Loader2 className="size-3 animate-spin" />
            Asking {sourceName} which languages it has…
          </p>
        )}
        <div className="grid grid-cols-2 gap-0.5">
          {options.map((option) => {
            const current = option === language;
            return (
              <DropdownMenuItem
                className={cn("gap-2 rounded-md px-2 py-1.5", current && "bg-accent text-foreground")}
                key={option}
                onSelect={() => { if (!current) onSelect(option); }}
              >
                <LanguageGlyph className="size-3.5 shrink-0" language={option} />
                <span className="min-w-0 flex-1 truncate">{LANGUAGE_LABEL[option]}</span>
                {current ? (
                  <Check className="size-3 shrink-0 text-muted-foreground" />
                ) : remoteOnly(option) && source ? (
                  <SourceGlyph className="size-3 shrink-0 opacity-60" source={source.source} />
                ) : null}
              </DropdownMenuItem>
            );
          })}
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
