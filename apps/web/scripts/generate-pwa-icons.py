"""Generate PersonAI PWA icons (192/512 any + maskable)."""
from __future__ import annotations

from pathlib import Path

from PIL import Image, ImageDraw

OUT = Path(__file__).resolve().parents[1] / "public"

SAGE = (47, 111, 94, 255)
SAGE_LIGHT = (126, 184, 164, 255)
CHARCOAL = (21, 24, 22, 255)
FG = (240, 242, 238, 255)


def draw_mark(d: ImageDraw.ImageDraw, size: int, color: tuple[int, int, int, int], inset: int = 0) -> None:
    content = size - inset * 2
    cx_offset = inset
    stroke = max(content // 12, 2)
    x0 = cx_offset + content // 2 - content // 7
    y0 = cx_offset + content // 2 - content // 4
    y1 = cx_offset + content // 2 + content // 4
    d.rounded_rectangle([x0, y0, x0 + stroke, y1], radius=max(stroke // 2, 1), fill=color)
    bowl_r = content // 6
    bbox = [x0, y0, x0 + bowl_r * 2 + stroke // 2, y0 + bowl_r * 2]
    d.arc(bbox, start=270, end=90, fill=color, width=stroke)


def make_any(size: int, path: Path) -> None:
    img = Image.new("RGBA", (size, size), CHARCOAL)
    d = ImageDraw.Draw(img)
    pad = size // 8
    d.rounded_rectangle(
        [pad, pad, size - pad - 1, size - pad - 1],
        radius=size // 5,
        fill=SAGE,
    )
    draw_mark(d, size, FG)
    img.save(path, "PNG", optimize=True)
    print(f"{path.name}: {img.size} ({path.stat().st_size} bytes)")


def make_maskable(size: int, path: Path) -> None:
    img = Image.new("RGBA", (size, size), SAGE)
    d = ImageDraw.Draw(img)
    content = int(size * 0.55)
    inset = (size - content) // 2
    d.rounded_rectangle(
        [inset, inset, inset + content - 1, inset + content - 1],
        radius=content // 5,
        fill=CHARCOAL,
    )
    # Draw mark relative to the inner square
    stroke = max(content // 10, 2)
    x0 = inset + content // 2 - content // 7
    y0 = inset + content // 2 - content // 4
    y1 = inset + content // 2 + content // 4
    d.rounded_rectangle([x0, y0, x0 + stroke, y1], radius=max(stroke // 2, 1), fill=SAGE_LIGHT)
    bowl_r = content // 5
    bbox = [x0, y0, x0 + bowl_r * 2 + stroke // 2, y0 + bowl_r * 2]
    d.arc(bbox, start=270, end=90, fill=SAGE_LIGHT, width=stroke)
    img.save(path, "PNG", optimize=True)
    print(f"{path.name}: {img.size} ({path.stat().st_size} bytes)")


if __name__ == "__main__":
    OUT.mkdir(parents=True, exist_ok=True)
    make_any(192, OUT / "icon-192.png")
    make_any(512, OUT / "icon-512.png")
    make_maskable(512, OUT / "icon-maskable-512.png")
    make_any(180, OUT / "apple-touch-icon.png")
