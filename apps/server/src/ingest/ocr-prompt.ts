/** CH-DE aware OCR prompt for LightOnOCR / Ollama vision. */
export const OCR_PROMPT = `Du bist ein Schweizer Dokumenten-OCR (CH-DE / Deutsch).
Extrahiere strukturierte Daten aus diesem gescannten Dokument (Handy-/Scanner-Foto, ggf. Rauschen, Schräglage, Stempel, Marker).

Kontext:
- Sprache meist Deutsch (Schweiz): ss statt ß, CHF, AHV, Fristen, Rechnungen, QR-Rechnung / Zahlteil.
- Swiss QR-bill: Suche Empfänger, IBAN/QR-IBAN, Betrag, Währung CHF/EUR, Referenz (QRR/SCOR/NON), Fälligkeit.
- Dokumenttypen:
  - Rechnung/QR-Rechnung=BILL
  - Quittung=RECEIPT
  - Arztzeugnis/Arztbericht/Befund/Medizinisches Zeugnis=MEDICAL_RECORD (nicht Misc)
  - Vertrag/Schuldanerkennung/Mietvertrag/privatrechtliche Anwaltsschreiben=LEGAL oder CONTRACT → Archiv 08_Legal
  - Gerichtsunterlagen/Gerichtsbeschluss/Vorladung/Klage/Urteil/Verfügung/Behördenschreiben/Amtliche Zustellung=OFFICIAL → Archiv 01_Official (nicht Misc, nicht LEGAL)
  - sonst OTHER
- Erfinde keine Beträge, IBANs oder Diagnosen. Unleserlich → null.

Return ONLY valid JSON (no markdown):
{
  "documentType": "BILL|MEDICAL_RECORD|LEGAL|CONTRACT|RECEIPT|OFFICIAL|OTHER",
  "vendor": string|null,
  "amount": number|null,
  "currency": "CHF"|string|null,
  "date": "YYYY-MM-DD"|null,
  "category": string|null,
  "vatAmount": number|null,
  "invoiceNumber": string|null,
  "iban": string|null,
  "reference": string|null,
  "referenceType": "QRR|SCOR|NON"|null,
  "creditorName": string|null,
  "creditorAddress": string|null,
  "dueDate": "YYYY-MM-DD"|null,
  "hasSwissQrBill": boolean,
  "pageLabel": string|null,
  "provider": string|null,
  "diagnosis": string|null,
  "medications": string[]|null,
  "parties": string[]|null,
  "summary": string
}

pageLabel: z.B. "Seite 1 von 2" wenn sichtbar. summary: 1–3 Sätze auf Deutsch.`;

export function parseStructured(raw: string): Record<string, unknown> {
  try {
    const match = raw.match(/\{[\s\S]*\}/);
    if (!match) return { summary: raw, documentType: "OTHER" };
    return JSON.parse(match[0]) as Record<string, unknown>;
  } catch {
    return { summary: raw, documentType: "OTHER" };
  }
}
