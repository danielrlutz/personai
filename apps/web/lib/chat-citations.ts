/** Parse / strip Team chat doc citations: [@doc:ID|label] */

export type DocCitation = {
  id: string;
  label: string;
};

export type CitableCatalogEntry = {
  id: string;
  name: string;
};

const CITE_RE = /\[@doc:([^|\]]+)\|([^\]]+)\]/g;

export function parseDocCitations(text: string): DocCitation[] {
  const out: DocCitation[] = [];
  const seen = new Set<string>();
  CITE_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = CITE_RE.exec(text)) !== null) {
    const id = m[1]?.trim();
    const label = m[2]?.trim();
    if (!id || !label || seen.has(id)) continue;
    seen.add(id);
    out.push({ id, label });
  }
  return out;
}

/** Remove citation markers for display (chips carry the links). */
export function stripDocCitations(text: string): string {
  return text
    .replace(CITE_RE, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/ {2,}/g, " ")
    .trimEnd();
}

/** Fallback: exact archive filename mentions from a local catalog. */
export function matchMentionedCitables(
  text: string,
  catalog: CitableCatalogEntry[],
): DocCitation[] {
  if (!text.trim() || catalog.length === 0) return [];
  const hay = text.toLowerCase();
  const sorted = [...catalog].sort((a, b) => b.name.length - a.name.length);
  const out: DocCitation[] = [];
  const seen = new Set<string>();
  for (const d of sorted) {
    const name = d.name.trim();
    if (name.length < 8) continue;
    if (!hay.includes(name.toLowerCase())) continue;
    if (seen.has(d.id)) continue;
    seen.add(d.id);
    out.push({ id: d.id, label: name });
  }
  return out;
}

export function collectDisplayCitations(
  text: string,
  catalog: CitableCatalogEntry[] = [],
): DocCitation[] {
  const explicit = parseDocCitations(text);
  const seen = new Set(explicit.map((c) => c.id));
  const mentioned = matchMentionedCitables(stripDocCitations(text), catalog).filter(
    (c) => !seen.has(c.id),
  );
  return [...explicit, ...mentioned];
}

export const CITE_FROM_ARCHIVE_SPECIALISTS = new Set([
  "legal_aide",
  "cfo",
  "medical_integrator",
]);

export function supportsCiteFromArchive(specialistId: string): boolean {
  return CITE_FROM_ARCHIVE_SPECIALISTS.has(specialistId);
}

const CITE_PREF_PREFIX = "personai.team.citeFromArchive:";

export function readCiteFromArchivePref(specialistId: string): boolean {
  if (typeof window === "undefined") return false;
  try {
    return localStorage.getItem(`${CITE_PREF_PREFIX}${specialistId}`) === "1";
  } catch {
    return false;
  }
}

export function writeCiteFromArchivePref(specialistId: string, on: boolean): void {
  try {
    localStorage.setItem(`${CITE_PREF_PREFIX}${specialistId}`, on ? "1" : "0");
  } catch {
    /* ignore */
  }
}
