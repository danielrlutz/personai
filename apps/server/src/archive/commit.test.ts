import assert from "node:assert/strict";
import path from "node:path";
import { guessMime, reconcileArchiveExtension, taxonomyFolderName } from "./commit.js";

// Extension must follow source bytes, never a misleading UI `.pdf` rename.
assert.equal(
  reconcileArchiveExtension("2026-08-09_OTHER_Unknown.pdf", "/tmp/uploads/doc/original.png"),
  "2026-08-09_OTHER_Unknown.png",
);
assert.equal(
  reconcileArchiveExtension("2026-08-09_BILL_Swisscom.png", "C:\\data\\original.pdf"),
  "2026-08-09_BILL_Swisscom.pdf",
);
assert.equal(
  reconcileArchiveExtension("2026-08-09_BILL_Swisscom.pdf", "/archive/original.pdf"),
  "2026-08-09_BILL_Swisscom.pdf",
);
assert.equal(
  reconcileArchiveExtension("evil/../name.pdf", "/x/original.jpg"),
  "name.jpg",
);

assert.equal(guessMime("a.png"), "image/png");
assert.equal(guessMime("a.PDF"), "application/pdf");
assert.equal(guessMime("a.bin", "image/webp"), "image/webp");

assert.equal(taxonomyFolderName(9), "09_Misc");
assert.equal(taxonomyFolderName(4), "04_Financial");

// Path basename safety — no directory segments survive.
const reconciled = reconcileArchiveExtension(
  path.join("nested", "2026-01-01_OTHER_X.pdf"),
  "/profile/uploads/id/original.png",
);
assert.equal(reconciled, "2026-01-01_OTHER_X.png");
assert.equal(path.basename(reconciled), reconciled);

console.log("archive commit naming / mime reconciliation checks ok");
