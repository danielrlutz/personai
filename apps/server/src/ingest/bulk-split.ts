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
 * Phone/ADF bulk scans (Genius Scan, etc.) are usually unrelated single pages
 * stacked into one PDF. Prefer per-page docs; multipage letters are re-merged
 * after OCR when pageLabel looks like "Seite 1 von 2".
 */
export function expandSegmentsForPhoneScanner(
  segments: PageSegment[],
  opts: { pageCount: number; creator?: string },
): PageSegment[] {
  const phone = isPhoneScannerCreator(opts.creator);
  if (phone && opts.pageCount >= 3) {
    return segments.flatMap((seg) =>
      seg.pages.map((p) => ({
        pages: [p],
        startPage: p.pageNumber,
        endPage: p.pageNumber,
      })),
    );
  }
  // Non-phone: only explode a single large unbroken run
  if (segments.length === 1 && opts.pageCount >= 8) {
    return segments[0]!.pages.map((p) => ({
      pages: [p],
      startPage: p.pageNumber,
      endPage: p.pageNumber,
    }));
  }
  return segments;
}

/** After per-page OCR, merge runs that declare "Seite 1 von N". */
export function mergeContinuationGroups(
  pages: PreparedPage[],
  structuredList: Array<Record<string, unknown>>,
): PageSegment[] {
  const groups: PageSegment[] = [];
  let i = 0;
  while (i < pages.length) {
    const label = String(structuredList[i]?.pageLabel ?? "");
    const match = label.match(/seite\s*(\d+)\s*von\s*(\d+)/i);
    const part = match ? Number(match[1]) : 0;
    const total = match ? Number(match[2]) : 0;
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
    if (nextType === "BILL" || nextType === "RECEIPT") {
      merged.documentType = nextType;
    }
  }

  merged.summary = summaries.filter(Boolean).join("\n---\n") || merged.summary;
  merged.pageCount = pages.length;
  return merged;
}
