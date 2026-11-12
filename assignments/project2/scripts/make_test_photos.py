#!/usr/bin/env python3
"""
Generate a small synthetic photo set with EXIF dates, for testing the pipeline
without your real photos:

    python scripts/make_test_photos.py test-photos
    python scripts/preprocess.py test-photos

Each year gets its own color and shape, so year selections are easy to verify.
Includes portrait, landscape and EXIF-rotated (orientation 6) images.
"""

import random
import sys
from pathlib import Path

from PIL import ExifTags, Image, ImageDraw

YEARS = {2021: (220, 80, 60), 2022: (60, 160, 90), 2023: (70, 110, 220), 2024: (230, 190, 60)}


def make(path: Path, size, color, year, month, kind, orientation=1, seed=0):
    rnd = random.Random(seed)
    w, h = size
    img = Image.new("RGB", (w, h), tuple(int(c * 0.35) for c in color))
    d = ImageDraw.Draw(img)
    cx, cy = w / 2 + rnd.uniform(-0.08, 0.08) * w, h / 2 + rnd.uniform(-0.08, 0.08) * h
    r = min(w, h) * rnd.uniform(0.22, 0.3)
    if kind == "circle":
        d.ellipse([cx - r, cy - r, cx + r, cy + r], fill=color)
    elif kind == "square":
        d.rectangle([cx - r, cy - r, cx + r, cy + r], fill=color)
    elif kind == "triangle":
        d.polygon([(cx, cy - r), (cx - r, cy + r), (cx + r, cy + r)], fill=color)
    else:
        d.rectangle([cx - r * 1.4, cy - r * 0.3, cx + r * 1.4, cy + r * 0.3], fill=color)
    exif = Image.Exif()
    exif[ExifTags.Base.Orientation] = orientation
    day = rnd.randint(1, 28)
    stamp = f"{year}:{month:02d}:{day:02d} {rnd.randint(7, 20):02d}:{rnd.randint(0, 59):02d}:00"
    exif[ExifTags.Base.DateTime] = stamp
    exif.get_ifd(ExifTags.IFD.Exif)[ExifTags.Base.DateTimeOriginal] = stamp
    img.save(path, quality=92, exif=exif)


def main():
    out = Path(sys.argv[1] if len(sys.argv) > 1 else "test-photos")
    out.mkdir(parents=True, exist_ok=True)
    kinds = {2021: "circle", 2022: "square", 2023: "triangle", 2024: "bar"}
    n = 0
    for year, color in YEARS.items():
        for k in range(12):
            month = 1 + (k * 7 + year) % 12
            variant = k % 4
            if variant == 3:
                size, orient = (2000, 1500), 1          # landscape
            elif variant == 2:
                size, orient = (2000, 1500), 6          # stored landscape, displayed portrait
            else:
                size, orient = (1500, 2000), 1          # portrait
            make(out / f"IMG_{year}_{k:02d}.jpg", size, color, year, month, kinds[year], orient, seed=n)
            n += 1
    print(f"Wrote {n} test photos to {out}")


if __name__ == "__main__":
    main()
