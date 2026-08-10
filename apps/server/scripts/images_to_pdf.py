#!/usr/bin/env python3
"""Build a multipage PDF from raster page images (Genius Scan segment archive).

Usage:
  python images_to_pdf.py <out.pdf> <page1.png> [page2.png ...]
"""
from __future__ import annotations

import sys
from pathlib import Path


def main() -> int:
    if len(sys.argv) < 3:
        print("Usage: images_to_pdf.py <out.pdf> <image> [image...]", file=sys.stderr)
        return 2
    try:
        import fitz
    except ImportError:
        print("PyMuPDF (fitz) is required", file=sys.stderr)
        return 2

    out = Path(sys.argv[1])
    images = [Path(p) for p in sys.argv[2:]]
    for img in images:
        if not img.is_file():
            print(f"Missing image: {img}", file=sys.stderr)
            return 1

    doc = fitz.open()
    try:
        for img_path in images:
            img_doc = fitz.open(str(img_path))
            try:
                # Convert image document → PDF page via insert_pdf of a 1-page PDF.
                pdf_bytes = img_doc.convert_to_pdf()
            finally:
                img_doc.close()
            page_pdf = fitz.open("pdf", pdf_bytes)
            try:
                doc.insert_pdf(page_pdf)
            finally:
                page_pdf.close()
        out.parent.mkdir(parents=True, exist_ok=True)
        doc.save(str(out))
    finally:
        doc.close()

    print(str(out))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
