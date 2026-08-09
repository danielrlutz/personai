import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { findSwissQrInPng } from "../src/ingest/swiss-qr.js";
import {
  expandSegmentsForPhoneScanner,
  segmentBulkPages,
  type PreparedPage,
} from "../src/ingest/bulk-split.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const bulkDir = path.join(root, "tmp/prepare-bulk");
const singleDir = path.join(root, "tmp/prepare-single");

const bulk = JSON.parse(fs.readFileSync(path.join(bulkDir, "manifest.json"), "utf8")) as {
  pageCount: number;
  creator: string;
  pages: Array<{
    pageNumber: number;
    file: string;
    blank: boolean;
    nearWhiteRatio: number;
  }>;
};

const pages: PreparedPage[] = bulk.pages.map((p) => ({
  index: p.pageNumber - 1,
  pageNumber: p.pageNumber,
  file: p.file,
  path: path.join(bulkDir, p.file),
  blank: p.blank,
  nearWhiteRatio: p.nearWhiteRatio,
}));

const segs = expandSegmentsForPhoneScanner(segmentBulkPages(pages), {
  pageCount: bulk.pageCount,
  creator: bulk.creator,
});

console.log(
  JSON.stringify(
    {
      creator: bulk.creator,
      pageCount: bulk.pageCount,
      blanks: pages.filter((p) => p.blank).map((p) => p.pageNumber),
      segmentCount: segs.length,
    },
    null,
    2,
  ),
);

for (const p of pages) {
  if (p.blank) continue;
  const qr = await findSwissQrInPng(p.path);
  if (qr) {
    console.log(
      "QR",
      p.pageNumber,
      qr.creditorName,
      qr.iban,
      "amount=",
      qr.amount,
      "ref=",
      qr.reference,
    );
  }
}

const singleQr = await findSwissQrInPng(path.join(singleDir, "page-001.png"));
console.log("single medical QR:", singleQr);
