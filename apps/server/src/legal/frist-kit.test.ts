import { describe, expect, it } from "vitest";
import {
  buildFristKitChecklist,
  buildFristKitPayload,
  buildFristKitTitle,
  buildLegalAideDeepLink,
  fristDay,
} from "./frist-kit.js";

describe("frist-kit", () => {
  it("normalizes deadline days", () => {
    expect(fristDay("2026-09-01T12:00:00.000Z")).toBe("2026-09-01");
    expect(fristDay("nope")).toBeNull();
  });

  it("builds title from archive name without inventing dates", () => {
    expect(
      buildFristKitTitle({ archiveName: "2026-08-10_COURT_Bern.pdf", deadline: "2026-09-01" }),
    ).toBe("Deadline (Frist): 2026-08-10_COURT_Bern.pdf");
  });

  it("builds checklist + Legal Aide deep-link", () => {
    const payload = buildFristKitPayload({
      archiveName: "2026-08-10_COURT_Bern.pdf",
      deadline: "2026-09-01",
      documentId: "doc_1",
    });
    expect(payload.deadline).toBe("2026-09-01");
    expect(payload.checklist).toContain("Deadline (Frist): 2026-09-01");
    expect(payload.checklist).toContain("do not invent");
    expect(payload.teamHref).toContain("/team/?specialist=legal_aide&q=");
    expect(decodeURIComponent(payload.teamHref)).toContain("Next actions checklist");
  });

  it("rejects missing Frist", () => {
    expect(() => buildFristKitPayload({ archiveName: "x.pdf" })).toThrow(/deadline/i);
  });

  it("deep-link encodes checklist", () => {
    const href = buildLegalAideDeepLink(
      buildFristKitChecklist({
        title: "Frist",
        deadline: "2026-09-01",
      }),
    );
    expect(href.startsWith("/team/?specialist=legal_aide&q=")).toBe(true);
  });
});
