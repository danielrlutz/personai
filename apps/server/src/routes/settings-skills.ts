import type { FastifyInstance } from "fastify";
import { createConfirmation } from "../confirm/confirm-service.js";
import {
  readHostVault,
  writeHostVault,
  type SkillStudioPref,
  type SkillStudioVault,
} from "../settings/host-vault.js";
import { SPECIALISTS } from "../specialists/roster.js";
import {
  DEFAULT_MAX_SKILL_CHARS,
  MAX_SKILL_CHARS_CAP,
  MIN_SKILL_CHARS,
  clampSkillChars,
  isSkillEnabledForSpecialist,
  listSkillCatalog,
  loadSkills,
  slugifySkillDir,
} from "../skills/registry.js";
import { sendError, withPrisma } from "./helpers.js";

const SPECIALIST_IDS = new Set(SPECIALISTS.map((s) => s.id));

function normalizeSpecialists(raw: unknown): string[] {
  if (!Array.isArray(raw)) return ["*"];
  const out: string[] = [];
  for (const item of raw) {
    if (typeof item !== "string") continue;
    const id = item.trim().toLowerCase();
    if (!id) continue;
    if (id === "*") {
      out.push("*");
      continue;
    }
    if (SPECIALIST_IDS.has(id)) out.push(id);
  }
  return out.length ? [...new Set(out)] : ["*"];
}

function mergeSkillStudioPrefs(patchPrefs: Record<string, unknown>): SkillStudioVault {
  const prev = readHostVault().skillStudio?.prefs ?? {};
  const next: Record<string, SkillStudioPref> = { ...prev };

  for (const [dirName, raw] of Object.entries(patchPrefs)) {
    const key = String(dirName).trim();
    if (!key || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(key)) continue;
    if (raw === null) {
      delete next[key];
      continue;
    }
    if (!raw || typeof raw !== "object") continue;
    const body = raw as Record<string, unknown>;
    const merged: SkillStudioPref = { ...(next[key] ?? {}) };

    if (typeof body.enabled === "boolean") merged.enabled = body.enabled;
    if (body.maxChars !== undefined) {
      merged.maxChars = clampSkillChars(
        typeof body.maxChars === "number" ? body.maxChars : Number(body.maxChars),
      );
    }
    if (Array.isArray(body.disabledSpecialists)) {
      merged.disabledSpecialists = [
        ...new Set(
          body.disabledSpecialists
            .filter((x): x is string => typeof x === "string")
            .map((x) => x.trim().toLowerCase())
            .filter((x) => SPECIALIST_IDS.has(x)),
        ),
      ];
    }
    if (typeof body.specialistId === "string" && typeof body.enabledForSpecialist === "boolean") {
      const sid = body.specialistId.trim().toLowerCase();
      if (SPECIALIST_IDS.has(sid)) {
        const disabled = new Set(merged.disabledSpecialists ?? []);
        if (body.enabledForSpecialist) disabled.delete(sid);
        else disabled.add(sid);
        merged.disabledSpecialists = [...disabled];
        if (body.enabledForSpecialist) merged.enabled = true;
      }
    }

    next[key] = merged;
  }

  return { prefs: next };
}

export async function registerSkillStudioRoutes(app: FastifyInstance): Promise<void> {
  app.get("/settings/skills", async (_req, reply) => {
    try {
      const catalog = listSkillCatalog();
      const skills = loadSkills();
      return {
        defaultMaxChars: DEFAULT_MAX_SKILL_CHARS,
        minChars: MIN_SKILL_CHARS,
        maxCharsCap: MAX_SKILL_CHARS_CAP,
        specialists: SPECIALISTS.map(({ id, label, shortLabel, group }) => ({
          id,
          label,
          shortLabel,
          group,
        })),
        skills: catalog.map((s) => {
          const full = skills.find((x) => x.dirName === s.dirName);
          return {
            ...s,
            bodyPreview: (full?.body ?? "").replace(/\s+/g, " ").trim().slice(0, 280),
            bodyChars: (full?.body ?? "").replace(/\s+/g, " ").trim().length,
            activeFor: SPECIALISTS.filter((sp) =>
              full ? isSkillEnabledForSpecialist(full, sp.id) : false,
            ).map((sp) => sp.id),
          };
        }),
      };
    } catch (err) {
      return sendError(reply, err);
    }
  });

  app.put<{ Body: Record<string, unknown> }>("/settings/skills", async (req, reply) => {
    try {
      const body = req.body ?? {};
      const prefsRaw = body.prefs;
      if (!prefsRaw || typeof prefsRaw !== "object" || Array.isArray(prefsRaw)) {
        return reply.status(400).send({ error: "prefs object is required" });
      }
      const skillStudio = mergeSkillStudioPrefs(prefsRaw as Record<string, unknown>);
      await writeHostVault({ skillStudio });

      try {
        const { prisma } = await withPrisma(req);
        await prisma.auditLog.create({
          data: {
            action: "settings.skills.update",
            entity: "SkillStudio",
            metadata: JSON.stringify({ keys: Object.keys(prefsRaw as object) }),
          },
        });
      } catch {
        /* vault can update before unlock */
      }

      return {
        ok: true,
        skills: listSkillCatalog(),
      };
    } catch (err) {
      return sendError(reply, err);
    }
  });

  /** Propose a new skill — stages Needs your confirmation before persist. */
  app.post<{ Body: Record<string, unknown> }>("/settings/skills/propose", async (req, reply) => {
    try {
      const body = req.body ?? {};
      const name = typeof body.name === "string" ? body.name.trim() : "";
      const description = typeof body.description === "string" ? body.description.trim() : "";
      const skillBody = typeof body.body === "string" ? body.body.trim() : "";
      if (!name || !description || !skillBody) {
        return reply.status(400).send({ error: "name, description, and body are required" });
      }
      if (name.length > 80 || description.length > 240 || skillBody.length > MAX_SKILL_CHARS_CAP * 2) {
        return reply.status(400).send({ error: "Skill fields exceed size limits" });
      }
      const specialists = normalizeSpecialists(body.specialists);
      const dirName = slugifySkillDir(
        typeof body.dirName === "string" && body.dirName.trim() ? body.dirName : name,
      );

      const { prisma } = await withPrisma(req);
      const confirmation = await createConfirmation(prisma, {
        action: "skill.create",
        summary: `Add skill “${name}” for ${specialists.includes("*") ? "all specialists" : specialists.join(", ")}`,
        entity: "Skill",
        entityId: `skill.create:${dirName}`,
        dedupeKey: `skill.create:${dirName}`,
        payload: {
          dirName,
          name,
          description,
          specialists,
          body: skillBody,
        },
      });

      await prisma.auditLog.create({
        data: {
          action: "settings.skills.propose",
          entity: "Skill",
          entityId: dirName,
          metadata: JSON.stringify({ confirmationId: confirmation.id, specialists }),
        },
      });

      return { confirmation, dirName };
    } catch (err) {
      return sendError(reply, err);
    }
  });
}
