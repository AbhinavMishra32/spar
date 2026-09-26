import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { parseSkill, SkillService } from "./skills.js";

function setup() {
  const root = mkdtempSync(path.join(tmpdir(), "spar-skills-"));
  const builtIn = path.join(root, "built-in");
  mkdirSync(path.join(builtIn, "figures"), { recursive: true });
  writeFileSync(path.join(builtIn, "figures", "SKILL.md"), "---\nname: figures\ndescription: Draw trees and graphs in statements.\n---\n\n# Figures\n\nBody.");
  const store = new Map<string, unknown>();
  const settings = { getSetting: <T,>(key: string, fallback: T) => (store.has(key) ? (store.get(key) as T) : fallback), setSetting: (key: string, value: unknown) => void store.set(key, value) };
  return new SkillService(builtIn, path.join(root, "user"), settings);
}

describe("SkillService", () => {
  it("lists built-ins and gives the agent only enabled names and descriptions", () => {
    const skills = setup();
    expect(skills.catalog()).toEqual([{ name: "figures", description: "Draw trees and graphs in statements." }]);
    skills.setEnabled("figures", false);
    expect(skills.catalog()).toEqual([]);
    expect(skills.read("figures", { forAgent: true })).toBeNull();
    expect(skills.read("figures")?.body).toContain("Body.");
  });

  it("lets a user copy override a built-in, and removing it restores the original", () => {
    const skills = setup();
    skills.customize("figures");
    expect(skills.list().map((skill) => [skill.source, skill.overridden])).toEqual([["user", false], ["built-in", true]]);
    expect(skills.read("figures")?.source).toBe("user");
    skills.remove("figures");
    expect(skills.read("figures")?.source).toBe("built-in");
    expect(() => skills.remove("figures")).toThrow(/turned off but not removed/);
  });

  it("saves, renames and validates user skills", () => {
    const skills = setup();
    expect(() => skills.save({ name: "Bad Name", description: "A long enough description.", body: "" })).toThrow(/lowercase/);
    expect(() => skills.save({ name: "drills", description: "short", body: "" })).toThrow(/Describe/);
    skills.save({ name: "drills", description: "Use for timed drills: quick ones.", body: "Do it." });
    skills.setEnabled("drills", false);
    skills.save({ name: "sprints", description: "Use for timed drills: quick ones.", body: "Do it.", previous: "drills" });
    const saved = skills.list().find((skill) => skill.name === "sprints");
    expect(saved?.enabled).toBe(false);
    expect(skills.list().some((skill) => skill.name === "drills")).toBe(false);
    expect(skills.read("sprints")?.description).toBe("Use for timed drills: quick ones.");
  });
});

describe("parseSkill", () => {
  it("needs a description and unquotes values", () => {
    expect(parseSkill("---\nname: x\n---\nbody")).toBeNull();
    expect(parseSkill('---\nname: x\ndescription: "Say \\"hi\\": now"\n---\nbody')).toEqual({ name: "x", description: 'Say "hi": now', body: "body" });
  });
});
