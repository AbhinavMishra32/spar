import { useMemo, useRef, useState } from "react";
import { Search } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * The Settings column, transcribed from construct rather than approximated.
 *
 * Three parts, in the order they matter: a search field pinned above the list,
 * the destinations in titled groups, and whatever the app wants to say at the
 * bottom. The list scrolls and the field does not, which is the point of
 * separating them — a search box that scrolls away is a search box you stop
 * using.
 *
 * The rows are buttons in the app's ghost shape held at 28px rather than 36,
 * because a settings column is a list you read down, not a stack of controls
 * you aim at. Only two things separate the selected row from the rest: a filled
 * chip, and its glyph going to full strength. No weight change, no rule, no
 * marker in the margin — the fill already says it, and a second signal reads as
 * two different kinds of selection.
 */

export type SidebarItem<Id extends string> = {
  id: Id;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  /** Section titles inside this page, which is what search actually matches
   *  against — nobody looks for "Appearance", they look for "Theme". */
  sections?: string[];
};

export type SidebarGroup<Id extends string> = { label: string; items: Array<SidebarItem<Id>> };

/* Construct's `v`, resolved against its button recipe: the base shape, the ghost
   variant, and `size="lg"` held down to `h-8`. Written out rather than composed,
   so the one row in the app that has to match theirs exactly can be read in one
   place. */
const ROW =
  "click-depth-slightly group/row flex h-8 w-full shrink-0 items-center justify-start gap-1.5 rounded-lg border border-transparent bg-clip-padding py-0 pr-2.5 pl-2 text-left text-sm font-medium whitespace-nowrap transition-all outline-none select-none";
const ROW_IDLE =
  "text-muted-foreground [&_svg]:text-muted-foreground hover:bg-muted hover:text-foreground dark:hover:bg-muted/50";
const ROW_ACTIVE = "bg-muted! text-foreground [&_svg]:text-primary";

/** A hit: the page it lives on, and the section inside it if the match was a
 *  section rather than the page's own name. */
type Hit<Id extends string> = { id: string; page: Id; title: string; breadcrumb?: string; section?: string };

function search<Id extends string>(groups: Array<SidebarGroup<Id>>, query: string): Array<Hit<Id>> {
  const terms = query.toLowerCase().trim().split(/\s+/).filter(Boolean);
  if (!terms.length) return [];
  const hits: Array<Hit<Id>> = [];
  for (const group of groups) {
    for (const item of group.items) {
      const matches = (text: string) => terms.every((term) => text.toLowerCase().includes(term));
      if (matches(item.label)) hits.push({ id: `page:${item.id}`, page: item.id, title: item.label, breadcrumb: group.label });
      for (const section of item.sections ?? []) {
        /* A section already named by its page — "Appearance" under Appearance —
           would be the same destination twice under two names. */
        if (section === item.label) continue;
        if (matches(section) || matches(item.label)) {
          hits.push({ id: `section:${item.id}:${section}`, page: item.id, title: section, breadcrumb: item.label, section });
        }
      }
    }
  }
  return hits;
}

export function SettingsSidebar<Id extends string>({
  active,
  footer,
  groups,
  onSelect,
}: {
  active: Id;
  footer?: React.ReactNode;
  groups: Array<SidebarGroup<Id>>;
  /** `section` is the heading to land on once the page is up, if the hit was a
   *  section rather than the page itself. */
  onSelect(id: Id, section?: string): void;
}) {
  const [query, setQuery] = useState("");
  const [cursor, setCursor] = useState(0);
  const field = useRef<HTMLInputElement>(null);

  const searching = query.trim().length > 0;
  const hits = useMemo(() => (searching ? search(groups, query) : []), [groups, query, searching]);

  const go = (hit: Hit<Id>) => {
    setQuery("");
    setCursor(0);
    onSelect(hit.page, hit.section);
  };

  const keydown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.nativeEvent.isComposing) return;
    if (event.key === "Escape") {
      event.preventDefault();
      /* Clear first, dismiss second: Escape on a full field means "not that",
         and on an empty one means "not this". */
      if (query) setQuery("");
      else field.current?.blur();
      return;
    }
    if (!hits.length) return;
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const step = event.key === "ArrowDown" ? 1 : -1;
      setCursor((index) => (index + step + hits.length) % hits.length);
      return;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      const hit = hits[cursor];
      if (hit) go(hit);
    }
  };

  return (
    <aside className="relative flex h-full w-52 shrink-0 flex-col py-1 pr-0 pl-1.5">
      {/* Above the scroller, and above the results it opens: the popover hangs
          out of the column, so the field has to own a stacking context the list
          cannot paint over. */}
      <div className="relative z-50 shrink-0">
        <div
          className="relative mb-3 flex h-8 w-full min-w-0 items-center rounded-lg border border-border bg-[var(--surface-primary)] shadow-xs transition-colors outline-none has-[input:focus-visible]:border-ring has-[input:focus-visible]:ring-3 has-[input:focus-visible]:ring-ring/50"
          role="group"
        >
          <div
            className="order-first flex h-auto cursor-text items-center justify-center gap-2 py-1.5 pl-2 text-sm font-medium text-muted-foreground select-none"
            onPointerDown={() => field.current?.focus()}
          >
            <Search className="size-4" />
          </div>
          <input
            ref={field}
            aria-controls={searching ? "settings-search-results" : undefined}
            aria-expanded={searching}
            aria-label="Search settings"
            className="min-w-0 flex-1 rounded-none border-0 bg-transparent pr-2 pl-1.5 text-sm shadow-none outline-none placeholder:text-muted-foreground"
            onChange={(event) => { setQuery(event.currentTarget.value); setCursor(0); }}
            onKeyDown={keydown}
            placeholder="Search.."
            role="combobox"
            value={query}
          />
        </div>

        {searching && (
          <div className="menu-surface absolute top-full left-1 mt-1 w-56 overflow-hidden rounded-xl p-1 shadow-xl">
            {hits.length === 0 ? (
              <p className="px-3 py-6 text-center text-sm text-muted-foreground">No settings found</p>
            ) : (
              <ul
                aria-label="Settings search results"
                className="max-h-80 overflow-y-auto overscroll-contain"
                id="settings-search-results"
                role="listbox"
              >
                {hits.map((hit, index) => (
                  <li aria-selected={index === cursor} key={hit.id} role="option">
                    <button
                      className={cn(ROW, ROW_IDLE, "h-auto min-h-10 items-start gap-0 py-1.5", index === cursor && ROW_ACTIVE)}
                      onClick={() => go(hit)}
                      onMouseEnter={() => setCursor(index)}
                      type="button"
                    >
                      <span className="min-w-0">
                        <span className="block truncate text-[13px] leading-4 text-foreground">{hit.title}</span>
                        {hit.breadcrumb && (
                          <span className="block truncate text-[11px] leading-4 text-muted-foreground">{hit.breadcrumb}</span>
                        )}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>

      <nav aria-label="Settings pages" className="app-scroll flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto pb-10">
        {groups.map((group) => (
          <div key={group.label}>
            {/* Inset to the rows rather than spaced away from them: the heading
                is a divider that happens to be readable, not a line of the list. */}
            <h5 className="px-2.5 pb-1 text-xs font-medium text-muted-foreground select-none">{group.label}</h5>
            <ul>
              {group.items.map(({ id, label, icon: Icon }) => (
                <li key={id}>
                  <button
                    className={cn(ROW, id === active ? ROW_ACTIVE : ROW_IDLE)}
                    data-active={id === active || undefined}
                    onClick={() => onSelect(id)}
                    type="button"
                  >
                    <Icon className="size-4 shrink-0" />
                    <span className="grow truncate">{label}</span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        ))}
        {footer}
      </nav>
    </aside>
  );
}
