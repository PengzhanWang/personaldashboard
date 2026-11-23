#!/usr/bin/env python3
"""Generate simple local PWA icons (no external assets needed)."""
from pathlib import Path
from PIL import Image, ImageDraw

OUT = Path(__file__).resolve().parent.parent / "public"
OUT.mkdir(parents=True, exist_ok=True)


def make_icon(size: int, filename: str) -> None:
    img = Image.new("RGBA", (size, size), (15, 23, 42, 255))  # slate-900
    draw = ImageDraw.Draw(img)
    pad = int(size * 0.14)
    r = int(size * 0.18)
    # Inner rounded card
    draw.rounded_rectangle([pad, pad, size - pad, size - pad], radius=r, fill=(30, 41, 59, 255))
    # Three minimal dashboard bars (accent sky/emerald/amber)
    bar_x0 = int(size * 0.25)
    bar_h = int(size * 0.10)
    gap = int(size * 0.08)
    y = int(size * 0.27)
    specs = [
        (0.50, (56, 189, 248, 255)),   # sky-400
        (0.38, (52, 211, 153, 255)),   # emerald-400
        (0.28, (251, 191, 36, 255)),   # amber-400
    ]
    for width_ratio, color in specs:
        bar_x1 = bar_x0 + int(size * width_ratio)
        draw.rounded_rectangle([bar_x0, y, bar_x1, y + bar_h], radius=bar_h // 2, fill=color)
        y += bar_h + gap
    img.save(OUT / filename, "PNG")


if __name__ == "__main__":
    make_icon(192, "icon-192.png")
    make_icon(512, "icon-512.png")
    make_icon(180, "apple-touch-icon.png")
    print("Generated icons in", OUT)
