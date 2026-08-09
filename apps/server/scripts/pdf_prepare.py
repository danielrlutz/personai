#!/usr/bin/env python3
"""Rasterize PDF pages for PersonAI OCR ingest.

Usage:
  python pdf_prepare.py <input.pdf> <out_dir> [--dpi 140] [--max-pages 40]

Writes page-001.png … and manifest.json with blank-page hints.
Prefers embedded page images (Genius Scan style) when present; otherwise renders.
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path


def ink_stats(pix) -> tuple[float, float]:
    samples = pix.samples
    if not samples:
        return 255.0, 1.0
    n = len(samples)
    mean = sum(samples) / n
    near_white = sum(1 for b in samples if b > 245) / n
    return mean, near_white


def extract_embedded(page, doc) -> bytes | None:
    images = page.get_images(full=True)
    if len(images) != 1:
        return None
    xref = images[0][0]
    info = doc.extract_image(xref)
    data = info.get("image")
    if not data:
        return None
    # Re-encode as PNG via pixmap for consistent QR/OCR input
    return None  # fall through to render — keeps colorspace/orientation correct


def render_page(page, dpi: float):
    import fitz

    zoom = dpi / 72.0
    return page.get_pixmap(matrix=fitz.Matrix(zoom, zoom), alpha=False)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("input")
    parser.add_argument("out_dir")
    parser.add_argument("--dpi", type=float, default=140)
    parser.add_argument("--max-pages", type=int, default=40)
    args = parser.parse_args()

    try:
        import fitz
    except ImportError:
        print("PyMuPDF (fitz) is required", file=sys.stderr)
        return 2

    src = Path(args.input)
    out = Path(args.out_dir)
    out.mkdir(parents=True, exist_ok=True)

    doc = fitz.open(str(src))
    pages_meta = []
    limit = min(doc.page_count, args.max_pages)

    for i in range(limit):
        page = doc[i]
        pix = render_page(page, args.dpi)
        name = f"page-{i + 1:03d}.png"
        path = out / name
        pix.save(str(path))
        mean, near_white = ink_stats(pix)
        # Phone/ADF pads are near-white but rarely pure; tune for Genius Scan separators
        blank = near_white >= 0.96 or mean >= 250.5
        pages_meta.append(
            {
                "index": i,
                "pageNumber": i + 1,
                "file": name,
                "width": pix.width,
                "height": pix.height,
                "meanBrightness": round(mean, 2),
                "nearWhiteRatio": round(near_white, 4),
                "blank": blank,
            }
        )

    manifest = {
        "source": str(src),
        "pageCount": doc.page_count,
        "renderedCount": limit,
        "truncated": doc.page_count > limit,
        "dpi": args.dpi,
        "creator": (doc.metadata or {}).get("creator") or "",
        "pages": pages_meta,
    }
    (out / "manifest.json").write_text(json.dumps(manifest, indent=2), encoding="utf-8")
    print(json.dumps({"ok": True, "renderedCount": limit, "pageCount": doc.page_count}))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
