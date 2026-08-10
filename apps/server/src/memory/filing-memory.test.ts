import assert from "node:assert/strict";
import {
  entityFactKey,
  entityFromArchiveName,
  formatEntityCategoryValue,
  isLearnableFilingCategory,
  normalizeEntityLabel,
  parseEntityCategoryValue,
  resolveFilingEntity,
} from "./filing-memory.js";

assert.equal(entityFactKey("Swisscom"), "entity.swisscom");
assert.equal(entityFactKey("CSS Versicherung"), "entity.css.versicherung");
assert.equal(entityFactKey("Unknown"), null);
assert.equal(entityFactKey("  "), null);
assert.equal(entityFactKey("A"), null);

assert.equal(normalizeEntityLabel("Swiss_Com AG"), "Swiss Com AG");
assert.equal(
  entityFromArchiveName("2026-08-09_BILL_Swisscom.pdf"),
  "Swisscom",
);
assert.equal(
  entityFromArchiveName("2026-08-09_BILL_CSS_Versicherung.png"),
  "CSS Versicherung",
);
assert.equal(entityFromArchiveName("random-file.pdf"), "");

assert.equal(
  resolveFilingEntity({ entity: "Swisscom", archiveName: "2026-08-09_BILL_Other.pdf" }),
  "Swisscom",
);
assert.equal(
  resolveFilingEntity({ archiveName: "2026-08-09_OFFICIAL_Gemeinde_Zürich.pdf" }),
  "Gemeinde Zürich",
);
assert.equal(resolveFilingEntity({ entity: "Unknown" }), "");

assert.equal(formatEntityCategoryValue(4), "cat 4 Financial");
assert.equal(formatEntityCategoryValue(1), "cat 1 Official");
assert.equal(parseEntityCategoryValue("cat 4 Financial"), 4);
assert.equal(parseEntityCategoryValue("cat 10 Vehicles"), 10);
assert.equal(parseEntityCategoryValue("4|Financial"), 4);
assert.equal(parseEntityCategoryValue("6"), 6);
assert.equal(parseEntityCategoryValue("nope"), null);
assert.equal(parseEntityCategoryValue("cat 99 Misc"), null);

assert.equal(isLearnableFilingCategory(4), true);
assert.equal(isLearnableFilingCategory(0), false);
assert.equal(isLearnableFilingCategory(11), false);

console.log("filing-memory checks ok");
