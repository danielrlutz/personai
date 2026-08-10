import assert from "node:assert/strict";
import {
  documentMatchesYear,
  normalizeJahresakteCategories,
  JAHRESAKTE_DEFAULT_CATEGORIES,
} from "./jahresakte-pack.js";
import { buildZipBuffer, crc32, sanitizeZipPath } from "./zip.js";

assert.deepEqual(normalizeJahresakteCategories(null), [...JAHRESAKTE_DEFAULT_CATEGORIES]);
assert.deepEqual(normalizeJahresakteCategories([4, 3, 3, 99, 0]), [3, 4]);

assert.equal(
  documentMatchesYear({ archiveName: "2025-03-01_BILL_Swisscom.pdf" }, 2025).match,
  true,
);
assert.equal(
  documentMatchesYear({ archiveName: "2025-03-01_BILL_Swisscom.pdf" }, 2024).match,
  false,
);
assert.equal(
  documentMatchesYear(
    { archiveName: "scan.pdf", uploadedAt: new Date("2024-06-01T12:00:00Z") },
    2024,
  ).via,
  "uploaded_at",
);
assert.equal(
  documentMatchesYear(
    {
      archiveName: "misc.pdf",
      deadline: new Date("2023-11-30T00:00:00Z"),
      uploadedAt: new Date("2025-01-01T00:00:00Z"),
    },
    2023,
  ).via,
  "deadline",
);

assert.equal(sanitizeZipPath("../04_Financial/a.pdf"), "04_Financial/a.pdf");
const payload = Buffer.from("hello-jahresakte");
const zip = buildZipBuffer([
  { name: "INDEX.pdf", data: payload },
  { name: "04_Financial/doc.pdf", data: Buffer.from("%PDF-1.4") },
]);
assert.ok(zip.length > 40);
assert.equal(zip.readUInt32LE(0), 0x04034b50);
assert.equal(crc32(payload), crc32(Buffer.from("hello-jahresakte")));

console.log("jahresakte-pack.test.ts: ok");
