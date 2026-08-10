/**
 * Learn naming conventions from Drive filenames (Invoice vs BILL, entity tokens, dates).
 * Feeds archive.naming.muscle MemoryFact + folder-match extra synonyms.
 */

export type NamingTokenKind = "doc_type" | "entity" | "date_pattern" | "folder_style";

export type NamingToken = {
  token: string;
  kind: NamingTokenKind;
  count: number;
  examples: string[];
};

const DATE_PATTERNS: Array<{ id: string; re: RegExp }> = [
  { id: "YYYY-MM-DD", re: /\b(20\d{2}-\d{2}-\d{2})\b/ },
  { id: "YYYYMMDD", re: /\b(20\d{2}\d{2}\d{2})\b/ },
  { id: "DD.MM.YYYY", re: /\b(\d{2}\.\d{2}\.20\d{2})\b/ },
  { id: "DD-MM-YYYY", re: /\b(\d{2}-\d{2}-20\d{2})\b/ },
];

/** Map free-form filename tokens → PersonAI DocType muscle memory. */
const DOC_TYPE_ALIASES: Record<string, string> = {
  invoice: "BILL",
  rechnung: "BILL",
  bill: "BILL",
  qr: "BILL",
  qrbill: "BILL",
  receipt: "RECEIPT",
  quittung: "RECEIPT",
  beleg: "RECEIPT",
  contract: "CONTRACT",
  vertrag: "CONTRACT",
  medical: "MEDICAL_RECORD",
  arzt: "MEDICAL_RECORD",
  health: "MEDICAL_RECORD",
  legal: "LEGAL",
  gericht: "LEGAL",
  frist: "LEGAL",
  official: "OFFICIAL",
  behoerde: "OFFICIAL",
  behorden: "OFFICIAL",
  amt: "OFFICIAL",
};

const STOP = new Set([
  "the",
  "and",
  "und",
  "der",
  "die",
  "das",
  "von",
  "für",
  "fur",
  "pdf",
  "png",
  "jpg",
  "jpeg",
  "scan",
  "copy",
  "final",
  "new",
  "doc",
  "file",
]);

function stripExt(name: string): string {
  return name.replace(/\.[A-Za-z0-9]{1,16}$/, "");
}

/** Detect PersonAI `{date}_{DocType}_{Entity}` or looser token splits. */
export function tokenizeFilename(name: string): {
  date: string | null;
  datePattern: string | null;
  docTypeRaw: string | null;
  docTypeCanonical: string | null;
  entity: string | null;
  tokens: string[];
} {
  const base = stripExt(String(name ?? "").trim());
  let date: string | null = null;
  let datePattern: string | null = null;
  for (const p of DATE_PATTERNS) {
    const m = base.match(p.re);
    if (m) {
      date = m[1] ?? null;
      datePattern = p.id;
      break;
    }
  }

  const personAi = base.match(/^(20\d{2}-\d{2}-\d{2})_([A-Za-z][A-Za-z0-9]*)_(.+)$/);
  if (personAi) {
    const raw = personAi[2] ?? null;
    const canon = raw ? (DOC_TYPE_ALIASES[raw.toLowerCase()] ?? raw.toUpperCase()) : null;
    return {
      date: personAi[1] ?? date,
      datePattern: datePattern ?? "YYYY-MM-DD",
      docTypeRaw: raw,
      docTypeCanonical: canon,
      entity: (personAi[3] ?? "").replace(/_/g, " ").trim() || null,
      tokens: base.split(/[_\s.-]+/).filter(Boolean),
    };
  }

  const parts = base
    .split(/[_\s.-]+/)
    .map((p) => p.trim())
    .filter((p) => p.length >= 2 && !STOP.has(p.toLowerCase()));

  let docTypeRaw: string | null = null;
  let docTypeCanonical: string | null = null;
  for (const p of parts) {
    const key = p.toLowerCase();
    if (DOC_TYPE_ALIASES[key]) {
      docTypeRaw = p;
      docTypeCanonical = DOC_TYPE_ALIASES[key]!;
      break;
    }
  }

  const entityParts = parts.filter((p) => {
    const k = p.toLowerCase();
    if (DOC_TYPE_ALIASES[k]) return false;
    if (/^\d+$/.test(p)) return false;
    if (/^20\d{2}/.test(p)) return false;
    return true;
  });

  return {
    date,
    datePattern,
    docTypeRaw,
    docTypeCanonical,
    entity: entityParts.slice(0, 3).join(" ") || null,
    tokens: parts,
  };
}

export function detectFolderNumberingStyle(folderName: string): string | null {
  const n = String(folderName ?? "").trim();
  if (/^\d{2}_/.test(n)) return "01_Label";
  if (/^\d{1,2}\.\s/.test(n)) return "1. Label";
  if (/^\d{2}\s*-\s/.test(n)) return "01 - Label";
  if (/^\d{1,2}\s/.test(n)) return "1 Label";
  return null;
}

export function accumulateTerminology(
  files: Array<{ name: string; folderLabel?: string | null }>,
): NamingToken[] {
  const map = new Map<string, NamingToken>();
  const bump = (token: string, kind: NamingTokenKind, example: string) => {
    const key = `${kind}:${token}`;
    const prev = map.get(key);
    if (prev) {
      prev.count += 1;
      if (prev.examples.length < 3 && !prev.examples.includes(example)) {
        prev.examples.push(example);
      }
      return;
    }
    map.set(key, { token, kind, count: 1, examples: [example] });
  };

  for (const f of files) {
    const parsed = tokenizeFilename(f.name);
    if (parsed.docTypeRaw && parsed.docTypeCanonical) {
      bump(`${parsed.docTypeRaw}→${parsed.docTypeCanonical}`, "doc_type", f.name);
    }
    if (parsed.entity && parsed.entity.length >= 2) {
      bump(parsed.entity.slice(0, 48), "entity", f.name);
    }
    if (parsed.datePattern) {
      bump(parsed.datePattern, "date_pattern", f.name);
    }
    if (f.folderLabel) {
      const style = detectFolderNumberingStyle(f.folderLabel);
      if (style) bump(style, "folder_style", f.folderLabel);
    }
  }

  return [...map.values()].sort((a, b) => b.count - a.count);
}

/** Compact muscle-memory blurb for prompts / MemoryFact. */
export function formatNamingMuscle(tokens: NamingToken[], maxChars = 900): string {
  const docTypes = tokens.filter((t) => t.kind === "doc_type").slice(0, 12);
  const entities = tokens.filter((t) => t.kind === "entity").slice(0, 15);
  const dates = tokens.filter((t) => t.kind === "date_pattern").slice(0, 4);
  const folders = tokens.filter((t) => t.kind === "folder_style").slice(0, 4);

  const lines = [
    "Drive naming muscle (learned from filenames; prefer these conventions):",
    docTypes.length
      ? `DocType aliases: ${docTypes.map((t) => `${t.token} (×${t.count})`).join("; ")}`
      : null,
    entities.length ? `Frequent entities: ${entities.map((t) => t.token).join(", ")}` : null,
    dates.length
      ? `Date patterns: ${dates.map((t) => `${t.token} (×${t.count})`).join("; ")}`
      : null,
    folders.length
      ? `Folder numbering: ${folders.map((t) => `${t.token} (×${t.count})`).join("; ")}`
      : null,
    "Canonical PersonAI archive name: {YYYY-MM-DD}_{DocType}_{Entity}{ext}. Map Invoice/Rechnung → BILL when filing.",
  ].filter(Boolean);

  return lines.join("\n").slice(0, maxChars);
}

/** Extra synonym strings per taxonomy category from indexed folder labels. */
export function folderAliasesFromLabels(
  folders: Array<{ archiveCategory: number | null; label: string }>,
): Record<number, string[]> {
  const out: Record<number, string[]> = {};
  for (const f of folders) {
    if (f.archiveCategory == null || f.archiveCategory < 1 || f.archiveCategory > 10) continue;
    const list = out[f.archiveCategory] ?? (out[f.archiveCategory] = []);
    const name = f.label.trim();
    if (name && !list.includes(name)) list.push(name);
  }
  return out;
}
