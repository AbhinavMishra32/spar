import { useMemo, useRef, useState } from "react";
import { IconMagnifyingGlass } from "central-icons";
import { cn } from "@/lib/utils";
import { ROW as SHELL_ROW, ROW_ICON, ROW_ICON_TONE, SectionLabel } from "../shell/Sidebar";

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

/* The app sidebar's own row, fill for hover and a step more for selection, so
   Settings reads as the same source list the rest of the window uses rather
   than as a second one drawn in its own hand. */
const ROW = SHELL_ROW;
const ROW_IDLE = "hover:bg-[var(--sidebar-accent)]";
const ROW_ACTIVE = "bg-[var(--sidebar-accent-active)]";

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
  embedded = false,
  footer,
  groups,
  onSelect,
}: {
  active: Id;
  /** Drawn inside the app sidebar rather than beside the sheet, which already
   *  gives it its width and its gutters. */
  embedded?: boolean;
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
    <aside className={cn("relative flex h-full flex-col", embedded ? "min-h-0 flex-1 px-2" : "app-sidebar w-56 shrink-0 px-2 py-1")}>
      {/* Above the scroller, and above the results it opens: the popover hangs
          out of the column, so the field has to own a stacking context the list
          cannot paint over. */}
      <div className="relative z-50 shrink-0">
        <div
          className="relative mb-2 flex h-[1.875rem] w-full min-w-0 items-center rounded-lg bg-[var(--sidebar-accent)] transition-colors outline-none has-[input:focus-visible]:ring-1 has-[input:focus-visible]:ring-ring"
          role="group"
        >
          <div
            className="order-first flex h-auto cursor-text items-center justify-center pl-2.5 text-muted-foreground select-none"
            onPointerDown={() => field.current?.focus()}
          >
            <IconMagnifyingGlass className={ROW_ICON} />
          </div>
          <input
            ref={field}
            aria-controls={searching ? "settings-search-results" : undefined}
            aria-expanded={searching}
            aria-label="Search settings"
            className="min-w-0 flex-1 rounded-none border-0 bg-transparent pr-2 pl-2 text-source shadow-none outline-none placeholder:text-muted-foreground"
            onChange={(event) => { setQuery(event.currentTarget.value); setCursor(0); }}
            onKeyDown={keydown}
            placeholder="Search settings"
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
                      className={cn(ROW, "h-auto min-h-10 items-start gap-0 py-1.5", index === cursor ? ROW_ACTIVE : ROW_IDLE)}
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

      <nav aria-label="Settings pages" className="app-scroll flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto pb-2">
        {groups.map((group) => (
          <div key={group.label}>
            {/* Inset to the rows rather than spaced away from them: the heading
                is a divider that happens to be readable, not a line of the list. */}
            <SectionLabel>{group.label}</SectionLabel>
            <ul className="space-y-0.5">
              {group.items.map(({ id, label, icon: Icon }) => (
                <li key={id}>
                  <button
                    className={cn(ROW, id === active ? ROW_ACTIVE : ROW_IDLE)}
                    data-active={id === active || undefined}
                    onClick={() => onSelect(id)}
                    type="button"
                  >
                    <Icon className={cn(ROW_ICON, ROW_ICON_TONE)} />
                    <span className="grow truncate text-left">{label}</span>
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
