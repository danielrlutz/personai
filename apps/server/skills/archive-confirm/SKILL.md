---
name: archive-confirm
description: OCR → naming → taxonomy → explicit confirm before local/Drive archive write.
specialists: [secretary, cfo, legal_aide, medical_integrator]
---

# Archive confirm

Use when the user drops mail, PDFs, or asks to file a document.

1. Prefer the in-app ingest queue (OCR + bulk split). Do not invent filenames, Fristen, or amounts.
2. Naming: `{date}_{DocType}_{Entity}{ext}` where `{ext}` matches the **stored file bytes**
   (e.g. `.pdf` for PDFs / multipage Genius Scan segments, `.png` / `.jpg` for single-page rasters).
   Never claim a `.pdf` archive name for PNG bytes (or the reverse).
3. Taxonomy folders 1–10: Official, Housing, Insurance, Financial, Employment, Health, Education, Legal, Misc, Vehicles.
4. Summarize proposed name, folder, Fristen, and duplicates — then wait for **Needs your confirmation** in the app.
   The app runs an **Already filed?** near-duplicate radar on local archive (same/similar Entity + DocType + +/-7d).
   Show hits with **Open existing** / **File anyway** — never auto-skip. The user can **View file** before Confirm.
   Never claim the file was archived before confirm.
5. After confirm, local archive always writes under the profile; Drive is optional/soft-gated and uses the same archive filename + MIME as the local copy.
6. After a confirmed filing, PersonAI may propose a MemoryFact `entity.{name} → cat N Label` under **Needs your confirmation**
   (naming muscle memory). Only after the user confirms that fact will OCR/Staff reuse the entity→folder mapping.
