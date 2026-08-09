import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export type SkillMeta = {
  name: string;
  description: string;
  specialists: string[];
  body: string;
  dirName: string;
};

type Frontmatter = {
  name?: string;
  description?: string;
  specialists?: string[];
};

const MAX_SKILL_CHARS = 1200;

function candidateRoots(): string[] {
  const here = path.dirname(fileURLToPath(import.meta.url));
  return [
    path.join(process.cwd(), "skills"),
    path.join(process.cwd(), "apps", "server", "skills"),
    path.resolve(here, "../../skills"),
    path.resolve(here, "../../../skills"),
  ];
}

export function resolveSkillsRoot(): string | null {
  for (const root of candidateRoots()) {
    try {
      if (fs.existsSync(root) && fs.statSync(root).isDirectory()) return root;
    } catch {
      /* try next */
    }
  }
  return null;
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

let cache: SkillMeta[] | null = null;

/** Load SKILL.md packs from apps/server/skills (Hermes-style registry). */
export function loadSkills(force = false): SkillMeta[] {
  if (cache && !force) return cache;
  const root = resolveSkillsRoot();
  if (!root) {
    cache = [];
    return cache;
  }
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
    });
  }
  skills.sort((a, b) => a.name.localeCompare(b.name));
  cache = skills;
  return skills;
}

export function skillsForSpecialist(specialistId: string): SkillMeta[] {
  const id = specialistId.trim().toLowerCase();
  return loadSkills().filter(
    (s) => s.specialists.includes("*") || s.specialists.map((x) => x.toLowerCase()).includes(id),
  );
}

/** Compact skill block injected into the system prompt (session-stable snapshot). */
export function formatSkillsForPrompt(specialistId: string): string {
  const skills = skillsForSpecialist(specialistId);
  if (skills.length === 0) return "";
  const blocks = skills.map((s) => {
    const body = s.body.replace(/\s+/g, " ").trim().slice(0, MAX_SKILL_CHARS);
    return `### ${s.name}\n${s.description}\n${body}`;
  });
  return `Active skills (follow when relevant; app confirm gates still apply):\n\n${blocks.join("\n\n")}`;
}

export function listSkillCatalog(): Array<{
  name: string;
  description: string;
  specialists: string[];
}> {
  return loadSkills().map(({ name, description, specialists }) => ({
    name,
    description,
    specialists,
  }));
}
