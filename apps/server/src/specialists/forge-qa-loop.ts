import type { PrismaClient } from "@prisma/client";
import { config } from "../config.js";
import { createConfirmation } from "../confirm/confirm-service.js";
import {
  chatCompletion,
  humanizeOllamaError,
  resolveOllamaHost,
} from "../ollama/client.js";
import { vramLock } from "../ollama/vram-lock.js";
import { getSpecialist } from "./roster.js";
import { resolveSpecialistModel } from "./resolve-model.js";

export const FORGE_QA_MAX_ATTEMPTS = 3;

export type QaVerdict = {
  verdict: "pass" | "fail";
  summary: string;
  issues: string[];
  criteria: Array<{ id: string; ok: boolean; note: string }>;
};

export type ForgeQaProgress =
  | { phase: "started"; maxAttempts: number }
  | { phase: "forge"; attempt: number; maxAttempts: number; model: string }
  | { phase: "qa"; attempt: number; maxAttempts: number; model: string }
  | {
      phase: "qa_result";
      attempt: number;
      maxAttempts: number;
      verdict: "pass" | "fail";
      summary: string;
      issues: string[];
    }
  | {
      phase: "ship_ready";
      attempt: number;
      confirmationId: string;
      summary: string;
    }
  | {
      phase: "exhausted";
      attempt: number;
      summary: string;
      issues: string[];
    }
  | { phase: "token"; role: "forge" | "qa"; attempt: number; token: string }
  | { phase: "done"; pass: boolean; attempts: number; proposal: string }
  | { phase: "error"; message: string };

function parseQaVerdict(raw: string): QaVerdict {
  const trimmed = raw.trim();
  const fenced = trimmed.match(/\{[\s\S]*\}/);
  const jsonStr = fenced ? fenced[0]! : trimmed;
  try {
    const parsed = JSON.parse(jsonStr) as Partial<QaVerdict>;
    const verdict = parsed.verdict === "pass" ? "pass" : "fail";
    return {
      verdict,
      summary: typeof parsed.summary === "string" ? parsed.summary : verdict,
      issues: Array.isArray(parsed.issues)
        ? parsed.issues.map(String).filter(Boolean)
        : [],
      criteria: Array.isArray(parsed.criteria)
        ? parsed.criteria.map((c, i) => ({
            id: String((c as { id?: string }).id ?? `c${i + 1}`),
            ok: Boolean((c as { ok?: boolean }).ok),
            note: String((c as { note?: string }).note ?? ""),
          }))
        : [],
    };
  } catch {
    const lower = trimmed.toLowerCase();
    const pass = /\bpass\b/.test(lower) && !/\bfail\b/.test(lower);
    return {
      verdict: pass ? "pass" : "fail",
      summary: trimmed.slice(0, 280) || (pass ? "pass" : "fail"),
      issues: pass ? [] : ["QA response was not valid JSON; treating as fail."],
      criteria: [],
    };
  }
}

/**
 * Orchestrate Forge propose → QA pass/fail → retry up to maxAttempts → confirm forge.ship.
 */
export async function runForgeQaLoop(opts: {
  prisma: PrismaClient;
  brief: string;
  userCare: string;
  maxAttempts?: number;
  onProgress: (event: ForgeQaProgress) => void;
}): Promise<{
  pass: boolean;
  attempts: number;
  proposal: string;
  confirmationId?: string;
}> {
  const maxAttempts = opts.maxAttempts ?? FORGE_QA_MAX_ATTEMPTS;
  const brief = opts.brief.trim();
  if (!brief) throw new Error("brief is required");

  opts.onProgress({ phase: "started", maxAttempts });

  const forge = getSpecialist("forge");
  const qa = getSpecialist("qa_auditor");
  let ollamaHost = "";
  let proposal = "";
  let lastVerdict: QaVerdict | null = null;

  const release = await vramLock.acquire("REASONING", () => {
    /* waiting — UI gets phase events */
  });

  try {
    ollamaHost = await resolveOllamaHost();
    const forgeResolved = await resolveSpecialistModel(ollamaHost, "forge");
    const qaResolved = await resolveSpecialistModel(ollamaHost, "qa_auditor");

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      opts.onProgress({
        phase: "forge",
        attempt,
        maxAttempts,
        model: forgeResolved.model,
      });

      const forgeUser =
        attempt === 1
          ? `Implement the following. Produce a concrete proposal (code, patches, or step list).\n\nBRIEF:\n${brief}`
          : `QA failed your previous proposal. Fix every issue and resubmit.\n\nBRIEF:\n${brief}\n\nPREVIOUS PROPOSAL:\n${proposal}\n\nQA SUMMARY:\n${lastVerdict?.summary ?? "fail"}\n\nISSUES:\n${(lastVerdict?.issues ?? []).map((i) => `- ${i}`).join("\n") || "- (see summary)"}`;

      proposal = await chatCompletion({
        host: ollamaHost,
        model: forgeResolved.model,
        messages: [
          {
            role: "system",
            content: `${forge.systemPrompt}\n\n${opts.userCare}`,
          },
          { role: "user", content: forgeUser },
        ],
      });

      if (!proposal.trim()) {
        throw new Error("Forge returned an empty proposal");
      }
      // Emit proposal as a single token chunk for UI transcript-style display.
      opts.onProgress({
        phase: "token",
        role: "forge",
        attempt,
        token: proposal,
      });

      opts.onProgress({
        phase: "qa",
        attempt,
        maxAttempts,
        model: qaResolved.model,
      });

      const qaRaw = await chatCompletion({
        host: ollamaHost,
        model: qaResolved.model,
        messages: [
          {
            role: "system",
            content: `${qa.systemPrompt}\n\n${opts.userCare}`,
          },
          {
            role: "user",
            content: `Review this Forge proposal against the brief. Respond with ONLY the JSON verdict object.\n\nBRIEF:\n${brief}\n\nPROPOSAL:\n${proposal}`,
          },
        ],
      });

      opts.onProgress({
        phase: "token",
        role: "qa",
        attempt,
        token: qaRaw,
      });

      lastVerdict = parseQaVerdict(qaRaw);
      opts.onProgress({
        phase: "qa_result",
        attempt,
        maxAttempts,
        verdict: lastVerdict.verdict,
        summary: lastVerdict.summary,
        issues: lastVerdict.issues,
      });

      if (lastVerdict.verdict === "pass") {
        const confirmation = await createConfirmation(opts.prisma, {
          action: "forge.ship",
          summary: `Ship Forge proposal (attempt ${attempt}/${maxAttempts}): ${lastVerdict.summary}`,
          entity: "ForgeShip",
          payload: {
            brief,
            proposal,
            attempt,
            qaSummary: lastVerdict.summary,
            criteria: lastVerdict.criteria,
          },
        });
        opts.onProgress({
          phase: "ship_ready",
          attempt,
          confirmationId: confirmation.id,
          summary: lastVerdict.summary,
        });
        opts.onProgress({
          phase: "done",
          pass: true,
          attempts: attempt,
          proposal,
        });
        return {
          pass: true,
          attempts: attempt,
          proposal,
          confirmationId: confirmation.id,
        };
      }
    }

    opts.onProgress({
      phase: "exhausted",
      attempt: maxAttempts,
      summary: lastVerdict?.summary ?? "QA did not pass",
      issues: lastVerdict?.issues ?? [],
    });
    opts.onProgress({
      phase: "done",
      pass: false,
      attempts: maxAttempts,
      proposal,
    });
    return { pass: false, attempts: maxAttempts, proposal };
  } catch (err) {
    const message = humanizeOllamaError(err, ollamaHost || undefined, config.reasoningModel);
    opts.onProgress({ phase: "error", message });
    throw new Error(message);
  } finally {
    await release();
  }
}
