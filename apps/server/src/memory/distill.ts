import type { PrismaClient } from "@prisma/client";
import { createConfirmation } from "../confirm/confirm-service.js";

export type DistillCandidate = {
  key: string;
  value: string;
  reason: string;
  sessionId?: string;
};

const REMEMBER_RE =
  /(?:^|\b)(?:remember(?:\s+that)?|merk(?:e)?\s*dir|notiere|note(?:\s+that)?)\s*[:\-–]?\s*(.+)$/i;
const PREFER_RE =
  /\b(?:i\s+(?:prefer|like|hate|need|want)|ich\s+(?:bevorzuge|mag|brauche|will))\b(.+)$/i;
const LIVE_WORK_RE =
  /\b(?:i\s+(?:live|work|live\s+in)|ich\s+(?:wohne|arbeite))\b(.+)$/i;

function slugKey(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/[^a-z0-9äöüéèêà._\s-]+/gi, "")
    .trim()
    .replace(/\s+/g, ".")
    .slice(0, 80);
}

function candidateFromLine(text: string): DistillCandidate | null {
  const line = text.replace(/\s+/g, " ").trim();
  if (line.length < 12 || line.length > 400) return null;

  let m = line.match(REMEMBER_RE);
  if (m?.[1]) {
    const value = m[1].trim();
    return {
      key: slugKey(`note.${value.slice(0, 40)}`) || "note.user",
      value,
      reason: "Explicit remember cue",
    };
  }
  m = line.match(PREFER_RE);
  if (m) {
    return {
      key: slugKey(`pref.${line.slice(0, 40)}`) || "pref.user",
      value: line,
      reason: "Preference statement",
    };
  }
  m = line.match(LIVE_WORK_RE);
  if (m) {
    return {
      key: slugKey(`bio.${line.slice(0, 40)}`) || "bio.user",
      value: line,
      reason: "Bio / location cue",
    };
  }
  return null;
}

/** Scan recent user turns + session digests for durable-looking facts (no extra LLM). */
export async function collectMemoryDistillCandidates(
  prisma: PrismaClient,
  opts?: { sessionId?: string; limitSessions?: number },
): Promise<DistillCandidate[]> {
  const limitSessions = opts?.limitSessions ?? 8;
  const sessions = opts?.sessionId
    ? await prisma.chatSession.findMany({
        where: { id: opts.sessionId },
        take: 1,
      })
    : await prisma.chatSession.findMany({
        orderBy: { updatedAt: "desc" },
        take: limitSessions,
      });

  const existing = await prisma.memoryFact.findMany({ select: { key: true, value: true } });
  const existingKeys = new Set(existing.map((f) => f.key.toLowerCase()));
  const existingValues = new Set(existing.map((f) => f.value.trim().toLowerCase()));

  const out: DistillCandidate[] = [];
  const seen = new Set<string>();

  for (const session of sessions) {
    if (session.sessionSummary?.trim()) {
      for (const part of session.sessionSummary.split(/\s*\|\s*/)) {
        const userBit = part.match(/^U:\s*(.+)$/i)?.[1];
        if (!userBit) continue;
        const c = candidateFromLine(userBit);
        if (!c) continue;
        c.sessionId = session.id;
        const dedupe = `${c.key}::${c.value}`.toLowerCase();
        if (seen.has(dedupe) || existingKeys.has(c.key.toLowerCase()) || existingValues.has(c.value.toLowerCase())) {
          continue;
        }
        seen.add(dedupe);
        out.push(c);
      }
    }

    const messages = await prisma.chatMessage.findMany({
      where: { sessionId: session.id, role: "USER" },
      orderBy: { createdAt: "desc" },
      take: 12,
      select: { content: true },
    });
    for (const msg of messages) {
      for (const line of msg.content.split(/\n+/)) {
        const c = candidateFromLine(line);
        if (!c) continue;
        c.sessionId = session.id;
        const dedupe = `${c.key}::${c.value}`.toLowerCase();
        if (seen.has(dedupe) || existingKeys.has(c.key.toLowerCase()) || existingValues.has(c.value.toLowerCase())) {
          continue;
        }
        seen.add(dedupe);
        out.push(c);
      }
    }
  }

  return out.slice(0, 12);
}

/** Queue confirm-gated memory promotions (OpenClaw-style promote, PersonAI confirm UX). */
export async function queueMemoryDistillConfirmations(
  prisma: PrismaClient,
  candidates: DistillCandidate[],
): Promise<{ queued: number; confirmations: unknown[] }> {
  const confirmations = [];
  for (const c of candidates.slice(0, 8)) {
    const confirmation = await createConfirmation(prisma, {
      action: "memory.fact",
      summary: `Remember: ${c.key} = ${c.value.slice(0, 120)}`,
      entity: "MemoryFact",
      dedupeKey: `memory.fact:${c.key}:${c.value.slice(0, 80)}`,
      payload: {
        key: c.key,
        value: c.value,
        source: "session-distill",
        reason: c.reason,
        sessionId: c.sessionId ?? null,
      },
    });
    confirmations.push(confirmation);
  }
  return { queued: confirmations.length, confirmations };
}
