import type { FastifyInstance } from "fastify";
import {
  resolveProductConfig,
  toPublicHostSettings,
  writeHostVault,
  type HostVaultData,
} from "../settings/host-vault.js";
import { setOllamaHostOverride, invalidateOllamaHostCache } from "../ollama/client.js";
import { sendError, withPrisma } from "./helpers.js";

export async function registerProductSettingsRoutes(app: FastifyInstance): Promise<void> {
  app.get("/settings/product", async (_req, reply) => {
    try {
      return toPublicHostSettings();
    } catch (err) {
      return sendError(reply, err);
    }
  });

  app.put<{ Body: Record<string, unknown> }>("/settings/product", async (req, reply) => {
    try {
      const body = req.body ?? {};
      const patch: Partial<HostVaultData> = {};

      const str = (k: string) => {
        if (!(k in body)) return;
        const v = body[k];
        if (v === null || v === "") {
          (patch as Record<string, null>)[k] = null;
          return;
        }
        if (typeof v === "string") (patch as Record<string, string>)[k] = v.trim();
      };

      str("ollamaHost");
      str("visionModel");
      str("reasoningModel");
      str("architectModel");
      str("coderModel");
      str("coachingModel");
      str("stylistModel");
      str("qaModel");
      str("publicWebUrl");
      str("publicApiUrl");
      str("googleOauthClientId");
      str("googleOauthRedirectUri");
      str("googleDriveRootFolderId");
      str("premiumProvider");

      // Secrets: only overwrite when a non-empty new value is provided (never accept masked ••••)
      if (typeof body.googleOauthClientSecret === "string") {
        const s = body.googleOauthClientSecret.trim();
        if (s && !s.startsWith("••••")) patch.googleOauthClientSecret = s;
        if (s === "") patch.googleOauthClientSecret = null;
      }
      if (typeof body.googleServiceAccountJson === "string") {
        const s = body.googleServiceAccountJson.trim();
        if (s && !s.startsWith("••••")) patch.googleServiceAccountJson = s;
        if (s === "") patch.googleServiceAccountJson = null;
      }
      if (typeof body.premiumApiKey === "string") {
        const s = body.premiumApiKey.trim();
        if (s && !s.startsWith("••••")) patch.premiumApiKey = s;
        if (s === "") patch.premiumApiKey = null;
      }

      if (body.googleDriveFolderIds && typeof body.googleDriveFolderIds === "object") {
        const map: Record<string, string> = {};
        for (const [k, v] of Object.entries(body.googleDriveFolderIds as Record<string, unknown>)) {
          if (typeof v === "string" && v.trim()) map[k] = v.trim();
        }
        patch.googleDriveFolderIds = map;
      }

      if (typeof body.premiumMonthlyQuota === "number" && Number.isFinite(body.premiumMonthlyQuota)) {
        patch.premiumMonthlyQuota = Math.max(0, Math.floor(body.premiumMonthlyQuota));
      }
      if (typeof body.notificationsEnabled === "boolean") {
        patch.notificationsEnabled = body.notificationsEnabled;
      }

      await writeHostVault(patch);

      const resolved = resolveProductConfig();
      if (patch.ollamaHost !== undefined && resolved.ollamaHost) {
        setOllamaHostOverride(resolved.ollamaHost);
      } else {
        invalidateOllamaHostCache();
      }

      // Audit when profile DB is unlocked
      try {
        const { prisma } = await withPrisma(req);
        await prisma.auditLog.create({
          data: {
            action: "settings.product.update",
            entity: "HostVault",
            metadata: JSON.stringify({
              keys: Object.keys(patch),
              secretsTouched: [
                "googleOauthClientSecret" in patch,
                "premiumApiKey" in patch,
                "googleServiceAccountJson" in patch,
              ].some(Boolean),
            }),
          },
        });
      } catch {
        // host settings can be written before profile unlock in edge cases
      }

      return toPublicHostSettings();
    } catch (err) {
      return sendError(reply, err);
    }
  });

  /** Encrypted backup of profile-safe export metadata (not plaintext secrets). */
  app.post("/settings/export-backup", async (req, reply) => {
    try {
      const { prisma } = await withPrisma(req);
      const [ceo, facts, settings, auditCount] = await Promise.all([
        prisma.ceoProfile.findUnique({ where: { id: "default" } }),
        prisma.memoryFact.findMany({ orderBy: { updatedAt: "desc" }, take: 200 }),
        prisma.setting.findMany(),
        prisma.auditLog.count(),
      ]);
      const publicSettings = settings.filter(
        (s) => !/secret|token|password|key|json/i.test(s.key),
      );
      const payload = {
        exportedAt: new Date().toISOString(),
        kind: "personai-profile-backup-v1",
        ceo,
        facts,
        settings: publicSettings,
        auditCount,
        note: "Sensitive host vault secrets are not included. Re-link Google / re-paste OAuth in Settings after restore.",
      };
      await prisma.auditLog.create({
        data: {
          action: "settings.export_backup",
          entity: "Backup",
          metadata: JSON.stringify({ facts: facts.length, settings: publicSettings.length }),
        },
      });
      reply.header("Content-Type", "application/json");
      reply.header(
        "Content-Disposition",
        `attachment; filename="personai-backup-${new Date().toISOString().slice(0, 10)}.json"`,
      );
      return reply.send(payload);
    } catch (err) {
      return sendError(reply, err);
    }
  });
}
