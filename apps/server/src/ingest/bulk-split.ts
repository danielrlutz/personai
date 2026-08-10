export type PreparedPage = {
  index: number;
  pageNumber: number;
  file: string;
  path: string;
  blank: boolean;
  nearWhiteRatio?: number;
  meanBrightness?: number;
};

export type PageSegment = {
  pages: PreparedPage[];
  startPage: number;
  endPage: number;
};

/**
 * Split a multipage bulk scan into document segments.
 * Blank separator pages (ADF/Genius Scan pads) become hard boundaries.
 * Single continuous runs stay together for multipage letters ("Seite 1 von 2").
 */
export function segmentBulkPages(pages: PreparedPage[]): PageSegment[] {
  if (pages.length === 0) return [];

  const segments: PageSegment[] = [];
  let current: PreparedPage[] = [];

  const flush = () => {
    if (current.length === 0) return;
    segments.push({
      pages: current,
      startPage: current[0]!.pageNumber,
      endPage: current[current.length - 1]!.pageNumber,
    });
    current = [];
  };

  for (const page of pages) {
    if (page.blank) {
      flush();
      continue;
    }
    current.push(page);
  }
  flush();

  if (segments.length === 0) {
    // All blank? treat as one segment of non-blank fallback (first page)
    const first = pages[0];
    if (first) {
      return [{ pages: [first], startPage: first.pageNumber, endPage: first.pageNumber }];
    }
  }

  return segments;
}

function isPhoneScannerCreator(creator?: string): boolean {
  const c = (creator ?? "").toLowerCase();
  return c.includes("genius scan") || c.includes("camscanner") || c.includes("adobe scan");
}

/**
 * @deprecated Prefer blank-segment + segmentAfterOcr. Kept for callers/tests that
 * still pass creator hints — no longer explodes Genius Scan stacks by default
 * (that dropped related multipage series when pageLabel OCR missed).
 *
 * Only expands when explicitly forced via opts.forcePerPage.
 */
export function expandSegmentsForPhoneScanner(
  segments: PageSegment[],
  opts: { pageCount: number; creator?: string; forcePerPage?: boolean },
): PageSegment[] {
  if (opts.forcePerPage) {
    return segments.flatMap((seg) =>
      seg.pages.map((p) => ({
        pages: [p],
        startPage: p.pageNumber,
        endPage: p.pageNumber,
      })),
    );
  }
  // Default: keep blank-separated runs intact (Genius / CamScanner / Adobe Scan).
  void isPhoneScannerCreator(opts.creator);
  void opts.pageCount;
  return segments;
}

/** Parse "Seite 1 von 2" / "Page 1 of 2" / "1/2" / "1 von 2". */
export function parsePageLabel(label: unknown): { part: number; total: number } | null {
  const s = String(label ?? "").trim();
  if (!s) return null;
  const patterns = [
    /seite\s*(\d+)\s*von\s*(\d+)/i,
    /page\s*(\d+)\s*of\s*(\d+)/i,
    /(\d+)\s*von\s*(\d+)/i,
    /\b(\d+)\s*\/\s*(\d+)\b/,
  ];
  for (const re of patterns) {
    const m = s.match(re);
    if (!m) continue;
    const part = Number(m[1]);
    const total = Number(m[2]);
    if (Number.isFinite(part) && Number.isFinite(total) && part >= 1 && total >= 1 && part <= total) {
      return { part, total };
    }
  }
  return null;
}

function entityKey(structured: Record<string, unknown>): string {
  const raw = String(
    structured.creditorName ?? structured.vendor ?? structured.provider ?? "",
  )
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
  return raw;
}

function ibanKey(structured: Record<string, unknown>): string {
  return String(structured.iban ?? "")
    .replace(/\s+/g, "")
    .toUpperCase();
}

function hasSwissQrSignal(structured: Record<string, unknown>): boolean {
  return Boolean(
    structured.hasSwissQrBill ||
      structured.qrPayload ||
      (ibanKey(structured) && structured.amount != null),
  );
}

function looksLikeIndependentDoc(structured: Record<string, unknown>): boolean {
  if (hasSwissQrSignal(structured)) return true;
  const type = String(structured.documentType ?? "OTHER").toUpperCase();
  if (type === "BILL" || type === "RECEIPT" || type === "INVOICE") {
    if (structured.invoiceNumber || structured.amount != null) return true;
  }
  const label = parsePageLabel(structured.pageLabel);
  if (label && label.part === 1 && label.total >= 1) return true;
  return false;
}

/**
 * After per-page OCR, merge runs that declare "Seite 1 von N" / "Page 1 of N".
 * Still used as a helper; prefer segmentAfterOcr for full boundary logic.
 */
export function mergeContinuationGroups(
  pages: PreparedPage[],
  structuredList: Array<Record<string, unknown>>,
): PageSegment[] {
  const groups: PageSegment[] = [];
  let i = 0;
  while (i < pages.length) {
    const parsed = parsePageLabel(structuredList[i]?.pageLabel);
    const part = parsed?.part ?? 0;
    const total = parsed?.total ?? 0;
    if (part === 1 && total > 1) {
      const slice = pages.slice(i, Math.min(i + total, pages.length));
      groups.push({
        pages: slice,
        startPage: slice[0]!.pageNumber,
        endPage: slice[slice.length - 1]!.pageNumber,
      });
      i += slice.length;
      continue;
    }
    groups.push({
      pages: [pages[i]!],
      startPage: pages[i]!.pageNumber,
      endPage: pages[i]!.pageNumber,
    });
    i += 1;
  }
  return groups;
}

/**
 * High-confidence boundary before `index` inside a blank-separated run.
 * Prefer keeping pages together; only split when signals are strong.
 */
export function hasHighConfidenceBoundary(
  prev: Record<string, unknown>,
  cur: Record<string, unknown>,
): boolean {
  const prevLabel = parsePageLabel(prev.pageLabel);
  const curLabel = parsePageLabel(cur.pageLabel);

  // Explicit new multipage series after previous series completed (or unlabeled).
  if (curLabel && curLabel.part === 1) {
    if (!prevLabel) return looksLikeIndependentDoc(cur) && looksLikeIndependentDoc(prev);
    if (prevLabel.part >= prevLabel.total) return true;
    // Mid-series "Seite 1" is noisy OCR — do not split.
    if (prevLabel.part < prevLabel.total) return false;
  }

  // Continuation page of same series → never split.
  if (
    prevLabel &&
    curLabel &&
    curLabel.total === prevLabel.total &&
    curLabel.part === prevLabel.part + 1
  ) {
    return false;
  }

  const prevIban = ibanKey(prev);
  const curIban = ibanKey(cur);
  if (prevIban && curIban && prevIban !== curIban && hasSwissQrSignal(prev) && hasSwissQrSignal(cur)) {
    return true;
  }

  const prevEnt = entityKey(prev);
  const curEnt = entityKey(cur);
  if (
    prevEnt &&
    curEnt &&
    prevEnt !== curEnt &&
    hasSwissQrSignal(prev) &&
    hasSwissQrSignal(cur)
  ) {
    return true;
  }

  // Two complete single-page bills back-to-back (each has QR / invoice#) with different entities.
  if (
    prevEnt &&
    curEnt &&
    prevEnt !== curEnt &&
    looksLikeIndependentDoc(prev) &&
    looksLikeIndependentDoc(cur) &&
    (!prevLabel || prevLabel.part >= prevLabel.total) &&
    (!curLabel || curLabel.part === 1)
  ) {
    return true;
  }

  return false;
}

/**
 * Segment pages after OCR.
 * - Prefer whole-document (related pages stay together).
 * - Honor explicit "Seite/Page N of M" continuation groups.
 * - Only split on high-confidence boundaries (distinct Swiss QR / completed series).
 * - Single Swiss QR (or clear single-doc) stack → one segment.
 */
export function segmentAfterOcr(
  pages: PreparedPage[],
  structuredList: Array<Record<string, unknown>>,
): PageSegment[] {
  if (pages.length === 0) return [];
  if (pages.length === 1) {
    return [{ pages, startPage: pages[0]!.pageNumber, endPage: pages[0]!.pageNumber }];
  }

  // Whole-document preference: at most one Swiss QR and no conflicting boundary → keep.
  const qrCount = structuredList.filter((s) => hasSwissQrSignal(s)).length;
  let anyBoundary = false;
  for (let i = 1; i < pages.length; i++) {
    if (hasHighConfidenceBoundary(structuredList[i - 1] ?? {}, structuredList[i] ?? {})) {
      anyBoundary = true;
      break;
    }
  }
  if (qrCount <= 1 && !anyBoundary) {
    // Still merge labeled continuations if labels say so (no-op when already whole).
    const labeled = mergeContinuationGroups(pages, structuredList);
    if (labeled.length === 1) return labeled;
    // Labels disagreed into multiple groups but no QR conflict — prefer whole doc.
    return [
      {
        pages,
        startPage: pages[0]!.pageNumber,
        endPage: pages[pages.length - 1]!.pageNumber,
      },
    ];
  }

  // Walk with continuation + high-confidence boundaries.
  const groups: PageSegment[] = [];
  let buf: PreparedPage[] = [pages[0]!];

  const flushBuf = () => {
    if (buf.length === 0) return;
    groups.push({
      pages: buf,
      startPage: buf[0]!.pageNumber,
      endPage: buf[buf.length - 1]!.pageNumber,
    });
    buf = [];
  };

  for (let i = 1; i < pages.length; i++) {
    const prev = structuredList[i - 1] ?? {};
    const cur = structuredList[i] ?? {};
    const prevLabel = parsePageLabel(prev.pageLabel);
    const curLabel = parsePageLabel(cur.pageLabel);

    // Absorb explicit continuation into current buffer.
    if (
      prevLabel &&
      curLabel &&
      curLabel.total === prevLabel.total &&
      curLabel.part === prevLabel.part + 1
    ) {
      buf.push(pages[i]!);
      continue;
    }

    // Start of labeled multipage series: take total pages when at boundary.
    if (curLabel && curLabel.part === 1 && curLabel.total > 1 && hasHighConfidenceBoundary(prev, cur)) {
      flushBuf();
      const slice = pages.slice(i, Math.min(i + curLabel.total, pages.length));
      groups.push({
        pages: slice,
        startPage: slice[0]!.pageNumber,
        endPage: slice[slice.length - 1]!.pageNumber,
      });
      i += slice.length - 1;
      buf = [];
      continue;
    }

    if (hasHighConfidenceBoundary(prev, cur)) {
      flushBuf();
      buf = [pages[i]!];
      continue;
    }

    buf.push(pages[i]!);
  }
  flushBuf();

  return groups.length > 0
    ? groups
    : [
        {
          pages,
          startPage: pages[0]!.pageNumber,
          endPage: pages[pages.length - 1]!.pageNumber,
        },
      ];
}

/**
 * Apply OCR segmentation within each blank-separated run, preserving run order.
 * Never drops pages: every non-blank page appears in exactly one output segment.
 */
export function segmentBlankRunsAfterOcr(
  blankSegments: PageSegment[],
  pageOcrByNumber: Map<number, Record<string, unknown>>,
): PageSegment[] {
  const out: PageSegment[] = [];
  for (const run of blankSegments) {
    const structured = run.pages.map(
      (p) => pageOcrByNumber.get(p.pageNumber) ?? { documentType: "OTHER" },
    );
    out.push(...segmentAfterOcr(run.pages, structured));
  }
  return out;
}

/** Merge structured OCR results from multiple pages of one document. */
export function mergePageExtractions(
  pages: Array<Record<string, unknown>>,
): Record<string, unknown> {
  if (pages.length === 0) return { documentType: "OTHER", summary: "" };
  if (pages.length === 1) return { ...pages[0]! };

  const merged: Record<string, unknown> = { ...pages[0]! };
  const summaries: string[] = [];

  for (const page of pages) {
    if (page.summary) summaries.push(String(page.summary));
    for (const key of [
      "iban",
      "reference",
      "amount",
      "currency",
      "creditorName",
      "dueDate",
      "vendor",
      "invoiceNumber",
      "date",
      "provider",
      "diagnosis",
      "category",
      "qrPayload",
      "referenceType",
    ] as const) {
      const cur = merged[key];
      const next = page[key];
      if ((cur == null || cur === "") && next != null && next !== "") {
        merged[key] = next;
      }
    }
    // Prefer more specific document types over OTHER
    const curType = String(merged.documentType ?? "OTHER");
    const nextType = String(page.documentType ?? "OTHER");
    if (curType === "OTHER" && nextType !== "OTHER") {
      merged.documentType = nextType;
    }
    if (
      nextType === "BILL" ||
      nextType === "RECEIPT" ||
      nextType === "INVOICE" ||
      /^invoice|rechnung$/i.test(nextType)
    ) {
      merged.documentType = nextType === "RECEIPT" ? "RECEIPT" : "BILL";
    }
  }

  merged.summary = summaries.filter(Boolean).join("\n---\n") || merged.summary;
  merged.pageCount = pages.length;
  return merged;
}
