import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "../config.js";
import { readHostVault, type SkillStudioPref } from "../settings/host-vault.js";

export type SkillSource = "builtin" | "user";

export type SkillMeta = {
  name: string;
  description: string;
  specialists: string[];
  body: string;
  dirName: string;
  source: SkillSource;
};

type Frontmatter = {
  name?: string;
  description?: string;
  specialists?: string[];
};

export const DEFAULT_MAX_SKILL_CHARS = 1200;
export const MIN_SKILL_CHARS = 120;
export const MAX_SKILL_CHARS_CAP = 2400;

function candidateBuiltinRoots(): string[] {
  const here = path.dirname(fileURLToPath(import.meta.url));
  return [
    path.join(process.cwd(), "skills"),
    path.join(process.cwd(), "apps", "server", "skills"),
    path.resolve(here, "../../skills"),
    path.resolve(here, "../../../skills"),
  ];
}

export function resolveBuiltinSkillsRoot(): string | null {
  for (const root of candidateBuiltinRoots()) {
    try {
      if (fs.existsSync(root) && fs.statSync(root).isDirectory()) return root;
    } catch {
      /* try next */
    }
  }
  return null;
}

/** User-proposed skills live next to the host vault (Settings-first control plane). */
export function userSkillsRoot(): string {
  return path.join(config.dataDir, "skills");
}

/** @deprecated use resolveBuiltinSkillsRoot */
export function resolveSkillsRoot(): string | null {
  return resolveBuiltinSkillsRoot();
}

function parseFrontmatter(raw: string): { meta: Frontmatter; body: string } {
  const m = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/);
  if (!m) return { meta: {}, body: raw.trim() };
  const meta: Frontmatter = {};
  for (const line of m[1]!.split(/\r?\n/)) {
    const idx = line.indexOf(":");
    if (idx < 0) continue;
    const key = line.slice(0, idx).trim();
    const value = line.slice(idx + 1).trim();
    if (key === "name") meta.name = value;
    else if (key === "description") meta.description = value;
    else if (key === "specialists") {
      meta.specialists = value
        .replace(/^\[|\]$/g, "")
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
    }
  }
  return { meta, body: m[2]!.trim() };
}

function loadSkillsFromRoot(root: string, source: SkillSource): SkillMeta[] {
  if (!fs.existsSync(root) || !fs.statSync(root).isDirectory()) return [];
  const skills: SkillMeta[] = [];
  for (const dirName of fs.readdirSync(root)) {
    const skillPath = path.join(root, dirName, "SKILL.md");
    if (!fs.existsSync(skillPath)) continue;
    const raw = fs.readFileSync(skillPath, "utf8");
    const { meta, body } = parseFrontmatter(raw);
    const name = meta.name?.trim() || dirName;
    skills.push({
      name,
      description: meta.description?.trim() || name,
      specialists: meta.specialists?.length ? meta.specialists : ["*"],
      body,
      dirName,
      source,
    });
  }
  return skills;
}

let cache: SkillMeta[] | null = null;

/** Load SKILL.md packs from apps/server/skills + DATA_DIR/skills (Hermes-style registry). */
export function loadSkills(force = false): SkillMeta[] {
  if (cache && !force) return cache;
  const byDir = new Map<string, SkillMeta>();
  const builtin = resolveBuiltinSkillsRoot();
  if (builtin) {
    for (const s of loadSkillsFromRoot(builtin, "builtin")) byDir.set(s.dirName, s);
  }
  // User skills override same dirName so confirmed proposals can refine packs.
  for (const s of loadSkillsFromRoot(userSkillsRoot(), "user")) byDir.set(s.dirName, s);
  const skills = [...byDir.values()].sort((a, b) => a.name.localeCompare(b.name));
  cache = skills;
  return skills;
}

export function invalidateSkillsCache(): void {
  cache = null;
}

export function clampSkillChars(n: number | null | undefined): number {
  if (typeof n !== "number" || !Number.isFinite(n)) return DEFAULT_MAX_SKILL_CHARS;
  return Math.min(MAX_SKILL_CHARS_CAP, Math.max(MIN_SKILL_CHARS, Math.floor(n)));
}

export function skillPrefFor(dirName: string): SkillStudioPref {
  const prefs = readHostVault().skillStudio?.prefs ?? {};
  return prefs[dirName] ?? {};
}

export function isSkillEnabledForSpecialist(skill: SkillMeta, specialistId: string): boolean {
  const pref = skillPrefFor(skill.dirName);
  if (pref.enabled === false) return false;
  const id = specialistId.trim().toLowerCase();
  const disabled = (pref.disabledSpecialists ?? []).map((x) => x.toLowerCase());
  if (disabled.includes(id)) return false;
  const targets = skill.specialists.map((x) => x.toLowerCase());
  return targets.includes("*") || targets.includes(id);
}

export function skillsForSpecialist(specialistId: string): SkillMeta[] {
  return loadSkills().filter((s) => isSkillEnabledForSpecialist(s, specialistId));
}

/** Compact skill block injected into the system prompt (session-stable snapshot). */
export function formatSkillsForPrompt(specialistId: string): string {
  const skills = skillsForSpecialist(specialistId);
  if (skills.length === 0) return "";
  const blocks = skills.map((s) => {
    const maxChars = clampSkillChars(skillPrefFor(s.dirName).maxChars);
    const body = s.body.replace(/\s+/g, " ").trim().slice(0, maxChars);
    return `### ${s.name}\n${s.description}\n${body}`;
  });
  return `Active skills (follow when relevant; app confirm gates still apply):\n\n${blocks.join("\n\n")}`;
}

export function listSkillCatalog(): Array<{
  name: string;
  description: string;
  specialists: string[];
  dirName: string;
  source: SkillSource;
  enabled: boolean;
  maxChars: number;
  disabledSpecialists: string[];
}> {
  return loadSkills().map((s) => {
    const pref = skillPrefFor(s.dirName);
    return {
      name: s.name,
      description: s.description,
      specialists: s.specialists,
      dirName: s.dirName,
      source: s.source,
      enabled: pref.enabled !== false,
      maxChars: clampSkillChars(pref.maxChars),
      disabledSpecialists: pref.disabledSpecialists ?? [],
    };
  });
}

export function slugifySkillDir(name: string): string {
  const slug = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
  return slug || "custom-skill";
}

export function renderSkillMarkdown(input: {
  name: string;
  description: string;
  specialists: string[];
  body: string;
}): string {
  const specialists = input.specialists.length ? input.specialists : ["*"];
  const body = input.body.trim();
  return (
    `---\n` +
    `name: ${input.name.trim()}\n` +
    `description: ${input.description.trim()}\n` +
    `specialists: [${specialists.join(", ")}]\n` +
    `---\n\n` +
    `${body}\n`
  );
}

/** Persist a confirmed user skill under DATA_DIR/skills (never overwrites builtin tree). */
export async function persistUserSkill(input: {
  dirName?: string;
  name: string;
  description: string;
  specialists: string[];
  body: string;
}): Promise<SkillMeta> {
  const dirName = slugifySkillDir(input.dirName || input.name);
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(dirName)) {
    throw new Error("Invalid skill directory name");
  }
  const root = userSkillsRoot();
  const dir = path.join(root, dirName);
  await fsp.mkdir(dir, { recursive: true });
  const md = renderSkillMarkdown({
    name: input.name.slice(0, 80),
    description: input.description.slice(0, 240),
    specialists: input.specialists,
    body: input.body.slice(0, MAX_SKILL_CHARS_CAP * 2),
  });
  await fsp.writeFile(path.join(dir, "SKILL.md"), md, "utf8");
  invalidateSkillsCache();
  const loaded = loadSkills(true).find((s) => s.dirName === dirName && s.source === "user");
  if (!loaded) throw new Error("Skill persisted but failed to reload");
  return loaded;
}
