#!/usr/bin/env python3
"""
Preprocess a folder of photos for the photo-average web app.

Run this on your own machine whenever the photo collection changes:

    python scripts/preprocess.py ~/Pictures/project-photos

It writes everything the site needs into public/data/:

    public/data/photos.json        metadata + layout for every photo
    public/data/hires/<id>.jpg     each photo, orientation-corrected and resized
                                   (the high-res refinement tier, and reusable pixel data)
    public/data/atlas-<n>.jpg      small copies packed into big sheets
                                   (the live-preview tier, loaded once onto the GPU)

Layout ("bounding box"): every photo is scaled to fit inside one shared box,
touching it on one axis and centered on the other, so nothing sticks out. The
box defaults to the most common photo size in the collection (set it with
--box 3000x4000). Areas a photo doesn't cover are treated as transparent by
the web app, so each pixel of the average only includes the photos that
actually cover it.

Requires: Pillow (pip install pillow). For iPhone HEIC files also:
pip install pillow-heif
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import shutil
from collections import Counter
import sys
from datetime import datetime, timezone
from pathlib import Path

from PIL import ExifTags, Image, ImageFile, ImageOps

# Some cameras/phones/exports leave a file a few bytes short. Pillow refuses those by
# default; the picture is almost always intact, so load what's there.
ImageFile.LOAD_TRUNCATED_IMAGES = True

try:  # optional HEIC/HEIF support
    from pillow_heif import register_heif_opener

    register_heif_opener()
    HEIF = True
except ImportError:
    HEIF = False

EXTENSIONS = {".jpg", ".jpeg", ".png", ".tif", ".tiff", ".webp"}
if HEIF:
    EXTENSIONS |= {".heic", ".heif"}

# EXIF tag numbers
TAG_ORIENTATION = 274
TAG_DATETIME = 306
TAG_DATETIME_ORIGINAL = 36867
TAG_DATETIME_DIGITIZED = 36868
TAG_OFFSET_TIME_ORIGINAL = 36881
SWAPPING_ORIENTATIONS = {5, 6, 7, 8}  # rotated 90/270 -> width and height swap

ATLAS_GUTTER = 2  # px of empty space between images in an atlas


# --------------------------------------------------------------------------- #
# Metadata
# --------------------------------------------------------------------------- #

def _gps_to_degrees(value, ref) -> float | None:
    try:
        d, m, s = (float(v) for v in value)
    except (TypeError, ValueError):
        return None
    deg = d + m / 60 + s / 3600
    if ref in ("S", "W", b"S", b"W"):
        deg = -deg
    return round(deg, 7)


def read_metadata(path: Path) -> dict:
    """Read size, orientation, capture time and GPS without decoding pixels."""
    with Image.open(path) as img:
        raw_w, raw_h = img.size
        exif = img.getexif()

    orientation = exif.get(TAG_ORIENTATION, 1) or 1
    w, h = (raw_h, raw_w) if orientation in SWAPPING_ORIENTATIONS else (raw_w, raw_h)

    exif_ifd = exif.get_ifd(ExifTags.IFD.Exif)
    raw_date = (
        exif_ifd.get(TAG_DATETIME_ORIGINAL)
        or exif_ifd.get(TAG_DATETIME_DIGITIZED)
        or exif.get(TAG_DATETIME)
    )
    date, date_source = None, None
    if raw_date:
        try:
            date = datetime.strptime(str(raw_date).strip("\x00 ")[:19], "%Y:%m:%d %H:%M:%S")
            date_source = "exif"
        except ValueError:
            pass
    if date is None:
        # Fall back to the file's modification time (flagged so you can fix it later).
        date = datetime.fromtimestamp(path.stat().st_mtime)
        date_source = "file"

    lat = lon = None
    gps = exif.get_ifd(ExifTags.IFD.GPSInfo)
    if gps:
        if 2 in gps and 4 in gps:
            lat = _gps_to_degrees(gps[2], gps.get(1))
            lon = _gps_to_degrees(gps[4], gps.get(3))

    return {
        "orientation": int(orientation),
        "raw_size": (raw_w, raw_h),
        "size": (w, h),  # after applying orientation
        "date": date,
        "date_source": date_source,
        "utc_offset": exif_ifd.get(TAG_OFFSET_TIME_ORIGINAL),
        "lat": lat,
        "lon": lon,
    }


def load_oriented(path: Path, orientation: int, target: tuple[int, int]) -> Image.Image:
    """Decode an image upright, as RGB. Uses JPEG DCT scaling when shrinking a lot."""
    img = Image.open(path)
    if img.format == "JPEG":
        tw, th = target
        if orientation in SWAPPING_ORIENTATIONS:
            tw, th = th, tw
        img.draft("RGB", (tw, th))  # decodes at >= target size, much faster
    img = ImageOps.exif_transpose(img)
    if img.mode != "RGB":
        if img.mode in ("RGBA", "LA", "P"):
            img = img.convert("RGBA")
            bg = Image.new("RGB", img.size, (0, 0, 0))
            bg.paste(img, mask=img.getchannel("A"))
            img = bg
        else:
            img = img.convert("RGB")
    return img


# --------------------------------------------------------------------------- #
# Atlas packing (simple shelf packer)
# --------------------------------------------------------------------------- #

def pack_shelves(sizes: list[tuple[int, int]], atlas_size: int) -> tuple[list[tuple[int, int, int]], list[int]]:
    """Return (atlas_index, x, y) for each size, and the used height of each atlas."""
    order = sorted(range(len(sizes)), key=lambda i: (-sizes[i][1], -sizes[i][0]))
    placements: list[tuple[int, int, int] | None] = [None] * len(sizes)
    used_heights: list[int] = []
    atlas = 0
    x = y = shelf_h = 0
    used_heights.append(0)
    for i in order:
        w, h = sizes[i]
        if w > atlas_size or h > atlas_size:
            raise ValueError(f"preview image {w}x{h} larger than atlas {atlas_size}")
        if x + w > atlas_size:  # next shelf
            x, y, shelf_h = 0, y + shelf_h + ATLAS_GUTTER, 0
        if y + h > atlas_size:  # next atlas
            atlas += 1
            used_heights.append(0)
            x = y = shelf_h = 0
        placements[i] = (atlas, x, y)
        x += w + ATLAS_GUTTER
        shelf_h = max(shelf_h, h)
        used_heights[atlas] = max(used_heights[atlas], y + h)
    return placements, used_heights  # type: ignore[return-value]


# --------------------------------------------------------------------------- #
# Main
# --------------------------------------------------------------------------- #

def photo_id(rel_path: str) -> str:
    return hashlib.sha1(rel_path.encode("utf-8")).hexdigest()[:12]


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("photos", type=Path, help="folder of photos (searched recursively)")
    ap.add_argument("--out", type=Path, default=Path(__file__).resolve().parent.parent / "public" / "data",
                    help="output folder (default: public/data in this project)")
    ap.add_argument("--preview-long", type=int, default=512,
                    help="long side of the live-preview canvas in px (default 512)")
    ap.add_argument("--hires-long", type=int, default=2000,
                    help="long side of the high-res canvas in px (default 2000)")
    ap.add_argument("--box", default=None,
                    help="bounding box every photo is fitted inside, e.g. 3000x4000 "
                         "(default: the most common photo size in the collection)")
    ap.add_argument("--atlas-size", type=int, default=4096, help="atlas sheet size in px (default 4096)")
    ap.add_argument("--quality", type=int, default=90, help="JPEG quality for outputs (default 90)")
    ap.add_argument("--hires-format", choices=["jpg", "png", "webp"], default="jpg",
                    help="file format for per-photo high-res images (png = lossless)")
    args = ap.parse_args()

    src: Path = args.photos.expanduser().resolve()
    if not src.is_dir():
        print(f"Not a folder: {src}", file=sys.stderr)
        return 1

    files = sorted(p for p in src.rglob("*") if p.suffix.lower() in EXTENSIONS and not p.name.startswith("."))
    if not files:
        print(f"No photos found in {src} (looked for {', '.join(sorted(EXTENSIONS))})", file=sys.stderr)
        if not HEIF:
            print("Tip: HEIC files need `pip install pillow-heif`.", file=sys.stderr)
        return 1

    # ---- pass 1: metadata only (fast) ------------------------------------- #
    print(f"Reading metadata for {len(files)} photos...")
    entries = []
    for p in files:
        try:
            meta = read_metadata(p)
        except Exception as e:  # unreadable file: skip, but say so
            print(f"  skip {p.name}: {e}", file=sys.stderr)
            continue
        rel = p.relative_to(src).as_posix()
        entries.append({"path": p, "rel": rel, "id": photo_id(rel), **meta})

    if not entries:
        print("No readable photos.", file=sys.stderr)
        return 1

    # ---- layout: every photo fits inside one bounding box --------------------- #
    # The box is the most common (upright) photo size in the collection, unless
    # --box is given. Each photo is scaled so it touches the box on one axis and
    # fits inside on the other ("contain"), then centered.
    if args.box:
        try:
            canvas_w, canvas_h = (float(v) for v in args.box.lower().split("x"))
        except ValueError:
            print(f"--box must look like 3000x4000, got {args.box!r}", file=sys.stderr)
            return 1
    else:
        canvas_w, canvas_h = Counter(e["size"] for e in entries).most_common(1)[0][0]
    for e in entries:
        w, h = e["size"]
        s = min(canvas_w / w, canvas_h / h)
        e["scaled"] = (w * s, h * s)
    canvas_long = max(canvas_w, canvas_h)

    def tier_dims(long_side: int) -> tuple[float, int, int]:
        f = min(1.0, long_side / canvas_long)
        return f, max(1, round(canvas_w * f)), max(1, round(canvas_h * f))

    pf, preview_w, preview_h = tier_dims(args.preview_long)
    hf, hires_w, hires_h = tier_dims(args.hires_long)

    for e in entries:
        sw, sh = e["scaled"]
        # normalized rect on the canvas (0..1, y down), centered
        e["rect"] = {
            "x": (canvas_w - sw) / 2 / canvas_w,
            "y": (canvas_h - sh) / 2 / canvas_h,
            "w": sw / canvas_w,
            "h": sh / canvas_h,
        }
        e["preview_size"] = (max(1, round(sw * pf)), max(1, round(sh * pf)))
        e["hires_size"] = (max(1, round(sw * hf)), max(1, round(sh * hf)))

    placements, atlas_heights = pack_shelves([e["preview_size"] for e in entries], args.atlas_size)

    # ---- prepare output folder --------------------------------------------- #
    out: Path = args.out.resolve()
    out.mkdir(parents=True, exist_ok=True)
    hires_dir = out / "hires"
    if hires_dir.exists():
        shutil.rmtree(hires_dir)
    hires_dir.mkdir()
    for old in out.glob("atlas-*.jpg"):
        old.unlink()

    # ---- pass 2: pixels, one atlas at a time (bounded memory) -------------- #
    photos_json = []
    failed: list[tuple[str, Exception]] = []
    n_atlases = len(atlas_heights)
    done = 0
    for a in range(n_atlases):
        atlas_h = (atlas_heights[a] + 3) // 4 * 4
        sheet = Image.new("RGB", (args.atlas_size, atlas_h), (0, 0, 0))
        for i, e in enumerate(entries):
            ai, ax, ay = placements[i]
            if ai != a:
                continue
            hires_name = f"hires/{e['id']}.{args.hires_format}"
            try:
                img = load_oriented(e["path"], e["orientation"], e["hires_size"])
                hires = img.resize(e["hires_size"], Image.LANCZOS) if img.size != e["hires_size"] else img
                save_kw = {"quality": args.quality} if args.hires_format in ("jpg", "webp") else {}
                if args.hires_format == "jpg":
                    save_kw["subsampling"] = 0  # keep full color resolution
                hires.save(out / hires_name, **save_kw)
            except Exception as err:  # unreadable/corrupt file: leave it out, keep going
                failed.append((e["rel"], err))
                done += 1
                continue

            pw, ph = e["preview_size"]
            sheet.paste(hires.resize((pw, ph), Image.LANCZOS), (ax, ay))

            photos_json.append({
                "id": e["id"],
                "source": e["rel"],
                "date": e["date"].isoformat(timespec="seconds"),
                "dateSource": e["date_source"],
                "utcOffset": e["utc_offset"],
                "lat": e["lat"],
                "lon": e["lon"],
                "original": {"width": e["size"][0], "height": e["size"][1], "orientation": e["orientation"]},
                "rect": {k: round(v, 6) for k, v in e["rect"].items()},
                "preview": {"atlas": a, "x": ax, "y": ay, "w": pw, "h": ph},
                "hires": {"file": hires_name, "width": e["hires_size"][0], "height": e["hires_size"][1]},
            })
            done += 1
            print(f"\r  processed {done}/{len(entries)}", end="", flush=True)
        sheet.save(out / f"atlas-{a}.jpg", quality=args.quality, subsampling=0)
    print()

    photos_json.sort(key=lambda p: p["date"])
    manifest = {
        "version": 1,
        "generated": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "canvas": {"width": round(canvas_w), "height": round(canvas_h)},
        "preview": {
            "width": preview_w,
            "height": preview_h,
            "atlases": [
                {"file": f"atlas-{a}.jpg", "width": args.atlas_size, "height": (h + 3) // 4 * 4}
                for a, h in enumerate(atlas_heights)
            ],
        },
        "hires": {"width": hires_w, "height": hires_h},
        "photos": photos_json,
    }
    (out / "photos.json").write_text(json.dumps(manifest, indent=1))

    if failed:
        print(f"Skipped {len(failed)} photo(s) that couldn't be decoded:")
        for rel, err in failed:
            print(f"  {rel}: {err}")
    n_file_dates = sum(1 for p in photos_json if p["dateSource"] == "file")
    print(f"Canvas {round(canvas_w)}x{round(canvas_h)} -> preview {preview_w}x{preview_h}, "
          f"high-res {hires_w}x{hires_h}, {n_atlases} atlas sheet(s)")
    if n_file_dates:
        print(f"Note: {n_file_dates} photo(s) had no EXIF date; used file modification time instead.")
    print(f"Wrote {out / 'photos.json'}")
    return 0


if __name__ == "__main__":
    sys.exit(main())