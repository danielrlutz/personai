import type { FastifyInstance } from "fastify";
import { chatCompletion, resolveOllamaHost } from "../ollama/client.js";
import { resolveSpecialistModel } from "../specialists/resolve-model.js";
import { SPECIALISTS, resolveSpecialistId } from "../specialists/roster.js";
import { vramLock } from "../ollama/vram-lock.js";
import { formatSnippetsForPrompt, searchMemorySnippets } from "../memory/rag-lite.js";
import { loadStagingPrefsHint } from "../memory/staging.js";
import { sendError, withPrisma } from "./helpers.js";

const SPECIALIST_IDS = SPECIALISTS.map((s) => s.id);

type TriageResult = {
  intent: string;
  specialistId: string;
  specialistLabel: string;
  confidence: number;
  summary: string;
  suggestedAction: "chat" | "archive" | "finance" | "legal" | "medical" | "brief";
  reason: string;
};

function heuristicTriage(text: string): TriageResult {
  const t = text.toLowerCase();
  const pick = (id: string, intent: string, action: TriageResult["suggestedAction"], reason: string, conf: number) => {
    const s = SPECIALISTS.find((x) => x.id === id)!;
    return {
      intent,
      specialistId: id,
      specialistLabel: s.label,
      confidence: conf,
      summary: text.trim().slice(0, 160),
      suggestedAction: action,
      reason,
    };
  };
  if (/qr[\s-]?rechnung|iban|chf\s*\d|invoice|rechnung|zahlung/.test(t)) {
    return pick("cfo", "finance.invoice", "finance", "Money / QR / invoice language", 0.72);
  }
  if (/frist|gericht|klage|vertrag|anwalt|legal|deadline/.test(t)) {
    return pick("legal_aide", "legal.deadline", "legal", "Legal / Frist language", 0.7);
  }
  if (/arzt|schmerz|symptom|medizin|krank|diagnosis|bloody/.test(t)) {
    return pick("medical_integrator", "medical.symptom", "medical", "Health / symptom language", 0.68);
  }
  if (/cv|lebenslauf|job|bewerbung|career/.test(t)) {
    return pick("career_strategist", "career.doc", "chat", "Career language", 0.65);
  }
  if (/code|bug|implement|architect|forge|ship/.test(t)) {
    return pick("architect", "build.plan", "chat", "Build / code language", 0.62);
  }
  if (/archiv|scan|pdf|beleg|document|upload/.test(t)) {
    return pick("secretary", "archive.file", "archive", "Document / archive language", 0.6);
  }
  return pick("secretary", "triage.general", "chat", "General triage → Staff", 0.45);
}

export async function registerTriageRoutes(app: FastifyInstance): Promise<void> {
  app.post<{ Body: { text?: string; hasFile?: boolean } }>("/triage", async (req, reply) => {
    try {
      const text = (req.body?.text ?? "").trim();
      if (!text && !req.body?.hasFile) {
        return reply.status(400).send({ error: "Paste text or attach a file to triage" });
      }

      const { prisma, profileId } = await withPrisma(req);
      const seed = text || (req.body?.hasFile ? "User dropped a document for filing / OCR." : "");
      let result = heuristicTriage(seed);

      const [snippets, prefsHint] = await Promise.all([
        searchMemorySnippets(prisma, profileId, { query: seed, limit: 6, snippetChars: 220 }),
        loadStagingPrefsHint(profileId, 700),
      ]);
      const snippetBlock = formatSnippetsForPrompt(snippets, 1000);
      const memoryContext = [prefsHint, snippetBlock].filter(Boolean).join("\n\n").slice(0, 1600);

      // Soft AI refine when Ollama is up — never block triage on model failure
      try {
        const host = await resolveOllamaHost();
        const resolved = await resolveSpecialistModel(host, "secretary");
        const release = await vramLock.acquire("REASONING");
        try {
          const system = `You are PersonAI Staff triage. Classify the user's dump into JSON only (no markdown):
{"intent":"short.snake","specialistId":"one of ${SPECIALIST_IDS.join("|")}","confidence":0.0-1.0,"summary":"≤120 chars","suggestedAction":"chat|archive|finance|legal|medical|brief","reason":"one short clause"}
Never invent Fristen or amounts. Prefer secretary when unsure.
Never use raw enum BILL in summary/reason — say Invoice (or the user's word).
When known prefs / personality notes are provided (hotel budget, location Cham/Zug, Invoice language, etc.), mention a relevant one briefly in reason if it affects routing — do not invent prefs.
${memoryContext ? `\n${memoryContext}` : ""}`;

          const raw = await chatCompletion({
            host,
            model: resolved.model,
            messages: [
              { role: "system", content: system },
              { role: "user", content: seed.slice(0, 4000) },
            ],
          });
          const jsonMatch = raw.match(/\{[\s\S]*\}/);
          if (jsonMatch) {
            const parsed = JSON.parse(jsonMatch[0]) as Partial<TriageResult>;
            const specialistId = resolveSpecialistId(parsed.specialistId);
            const specialist = SPECIALISTS.find((s) => s.id === specialistId)!;
            result = {
              intent: String(parsed.intent ?? result.intent),
              specialistId,
              specialistLabel: specialist.label,
              confidence: Math.min(1, Math.max(0, Number(parsed.confidence ?? result.confidence))),
              summary: String(parsed.summary ?? result.summary).slice(0, 160),
              suggestedAction: (parsed.suggestedAction as TriageResult["suggestedAction"]) ?? result.suggestedAction,
              reason: String(parsed.reason ?? result.reason),
            };
          }
        } finally {
          await release();
        }
      } catch {
        // heuristic stands
      }

      await prisma.auditLog.create({
        data: {
          action: "triage.propose",
          entity: "Triage",
          metadata: JSON.stringify({
            intent: result.intent,
            specialistId: result.specialistId,
            confidence: result.confidence,
            memoryHits: snippets.length,
          }),
        },
      });

      return {
        triage: result,
        specialists: SPECIALISTS.map((s) => ({ id: s.id, label: s.label, shortLabel: s.shortLabel })),
        memorySnippets: snippets,
      };
    } catch (err) {
      return sendError(reply, err);
    }
  });
}
