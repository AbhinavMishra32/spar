import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { SkillDraft, SkillSummary } from "../shared/api.js";

/**
 * Skills: instructions the agent reads only when a turn needs them.
 *
 * A skill is a folder holding a `SKILL.md` — YAML-ish frontmatter with a `name`
 * and a `description`, then a markdown body. The system prompt carries only the
 * name and description of each enabled skill; the body stays on disk until the
 * agent calls `load_skill`, so a long reference like the figure spec costs the
 * context nothing on the many turns that never draw one.
 *
 * Two roots. Built-in skills ship with the app and are read-only; the learner's
 * own live under the user-data directory and can be written, edited, imported
 * and removed from Settings. A user skill with a built-in's name overrides it —
 * that is how a built-in is customised: copy it, then edit the copy — and the
 * built-in stays listed, marked overridden, so removing the copy restores it.
 */

export const SKILL_NAME = /^[a-z0-9][a-z0-9-]{0,47}$/;
const DISABLED_KEY = "skills-disabled";

type Settings = { getSetting<T>(key: string, fallback: T): T; setSetting(key: string, value: unknown): void };
type Loaded = SkillSummary & { body: string };

export class SkillService {
  constructor(
    private readonly builtInRoot: string,
    private readonly userRoot: string,
    private readonly settings: Settings,
  ) {
    mkdirSync(userRoot, { recursive: true });
  }

  /** Every skill on disk, built-in first, each with whether it is enabled. */
  list(): SkillSummary[] {
    return this.load().map(({ body: _body, ...summary }) => summary);
  }

  /** The skills that answer to their name: a user skill over a built-in one. */
  private active(): Loaded[] {
    return this.load().filter((skill) => !skill.overridden);
  }

  /** What the agent is told exists: enabled skills, name and description only. */
  catalog(): { name: string; description: string }[] {
    return this.active().filter((skill) => skill.enabled).map(({ name, description }) => ({ name, description }));
  }

  /** One skill with its body, for the agent (enabled only) or for Settings. */
  read(name: string, { forAgent = false } = {}): Loaded | null {
    const skill = this.active().find((entry) => entry.name === name) ?? null;
    if (forAgent && skill && !skill.enabled) return null;
    return skill;
  }

  /** Creates or replaces a user skill. `previous` renames one in place. */
  save(draft: SkillDraft): SkillSummary {
    const name = draft.name.trim();
    if (!SKILL_NAME.test(name)) throw new Error("A skill name is lowercase letters, numbers and dashes, starting with a letter or number.");
    const description = draft.description.replace(/\s+/g, " ").trim();
    if (description.length < 12) throw new Error("Describe when the agent should use this skill — it is the only part the agent sees until it loads it.");
    const existing = this.load();
    if (name !== draft.previous && existing.some((skill) => skill.name === name && skill.source === "user")) throw new Error(`You already have a skill called “${name}”.`);
    /* A rename moves the folder, so anything kept beside SKILL.md — scripts,
       references — goes with it. */
    if (draft.previous && draft.previous !== name) {
      const before = existing.find((skill) => skill.name === draft.previous && skill.source === "user");
      if (before) renameSync(path.dirname(before.path), path.join(this.userRoot, name));
      this.rename(draft.previous, name);
    }
    const folder = path.join(this.userRoot, name);
    mkdirSync(folder, { recursive: true });
    writeFileSync(path.join(folder, "SKILL.md"), serialize(name, description, draft.body));
    return this.list().find((skill) => skill.name === name)!;
  }

  /** Copies a skill folder the learner picked — SKILL.md and whatever sits
   *  beside it — into their own skills. */
  importFolder(folder: string): SkillSummary {
    const parsed = parseSkill(readText(path.join(folder, "SKILL.md")) ?? "");
    if (!parsed) throw new Error("That folder has no SKILL.md with a description in its frontmatter.");
    const name = SKILL_NAME.test(parsed.name) ? parsed.name : slug(parsed.name || path.basename(folder));
    if (!SKILL_NAME.test(name)) throw new Error("Could not make a skill name from that folder. Rename it to lowercase letters, numbers and dashes.");
    if (this.load().some((skill) => skill.name === name && skill.source === "user")) throw new Error(`You already have a skill called “${name}”.`);
    const target = path.join(this.userRoot, name);
    cpSync(folder, target, { recursive: true, filter: (source) => !/(^|[\\/])(node_modules|\.git)([\\/]|$)/.test(path.relative(folder, source)) });
    return this.list().find((skill) => skill.name === name && skill.source === "user")!;
  }

  /** A built-in, copied into the learner's skills so it can be edited. The copy
   *  overrides the original from then on. */
  customize(name: string): SkillSummary {
    const skill = this.load().find((entry) => entry.name === name && entry.source === "built-in");
    if (!skill) throw new Error(`No built-in skill is called “${name}”.`);
    if (this.load().some((entry) => entry.name === name && entry.source === "user")) throw new Error(`You already have your own copy of “${name}”.`);
    cpSync(path.dirname(skill.path), path.join(this.userRoot, name), { recursive: true });
    return this.list().find((entry) => entry.name === name && entry.source === "user")!;
  }

  remove(name: string): void {
    const skill = this.load().find((entry) => entry.name === name && entry.source === "user");
    if (!skill) throw new Error("Built-in skills can be turned off but not removed.");
    rmSync(path.dirname(skill.path), { recursive: true, force: true });
  }

  setEnabled(name: string, enabled: boolean): void {
    const disabled = new Set(this.disabled());
    if (enabled) disabled.delete(name); else disabled.add(name);
    this.settings.setSetting(DISABLED_KEY, [...disabled]);
  }

  get userFolder(): string {
    return this.userRoot;
  }

  private rename(from: string, to: string) {
    const disabled = this.disabled();
    if (disabled.includes(from)) this.settings.setSetting(DISABLED_KEY, disabled.map((name) => (name === from ? to : name)));
  }

  private disabled(): string[] {
    const value = this.settings.getSetting<unknown>(DISABLED_KEY, []);
    return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string") : [];
  }

  /* Read fresh every time: the files are small, a turn reads them once, and a
     skill the learner just edited in their own editor should be the one the
     next turn sees. */
  private load(): Loaded[] {
    const disabled = new Set(this.disabled());
    const skills: Loaded[] = [];
    for (const [root, source] of [[this.userRoot, "user"], [this.builtInRoot, "built-in"]] as const) {
      const seen = new Set<string>();
      for (const folder of folders(root)) {
        const file = path.join(root, folder, "SKILL.md");
        const parsed = parseSkill(readText(file) ?? "");
        if (!parsed) continue;
        const name = SKILL_NAME.test(parsed.name) ? parsed.name : folder;
        if (!SKILL_NAME.test(name) || seen.has(name)) continue;
        seen.add(name);
        const overridden = source === "built-in" && skills.some((skill) => skill.source === "user" && skill.name === name);
        skills.push({ name, description: parsed.description, body: parsed.body, source, enabled: !disabled.has(name), overridden, path: file });
      }
    }
    return skills;
  }
}

function slug(value: string): string {
  return value.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 48);
}

function folders(root: string): string[] {
  if (!existsSync(root)) return [];
  try {
    return readdirSync(root, { withFileTypes: true }).filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort();
  } catch {
    return [];
  }
}

function readText(file: string): string | null {
  try {
    return readFileSync(file, "utf8");
  } catch {
    return null;
  }
}

/**
 * Frontmatter, read the way SKILL.md files are written in the wild: `key: value`
 * lines between `---` fences, values optionally quoted. Nothing nested is needed
 * and a YAML dependency for two strings is not worth carrying. A file without a
 * description is not a skill — the description is how the agent decides.
 */
export function parseSkill(source: string): { name: string; description: string; body: string } | null {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(source.replace(/^﻿/, ""));
  if (!match) return null;
  const fields: Record<string, string> = {};
  for (const line of match[1]!.split(/\r?\n/)) {
    const field = /^([A-Za-z][\w-]*):\s*(.*)$/.exec(line);
    if (field) fields[field[1]!.toLowerCase()] = unquote(field[2]!.trim());
  }
  const description = (fields.description ?? "").trim();
  if (!description) return null;
  return { name: (fields.name ?? "").trim(), description, body: match[2]!.trim() };
}

function unquote(value: string): string {
  if (value.startsWith('"') && value.endsWith('"')) {
    try { return String(JSON.parse(value)); } catch { return value.slice(1, -1); }
  }
  return value.startsWith("'") && value.endsWith("'") ? value.slice(1, -1).replace(/''/g, "'") : value;
}

function serialize(name: string, description: string, body: string): string {
  const quoted = /[:#"'\n]|^\s|\s$/.test(description) ? JSON.stringify(description) : description;
  return `---\nname: ${name}\ndescription: ${quoted}\n---\n\n${body.trim()}\n`;
}
