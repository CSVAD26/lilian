# Photo average

Pick a time range on the timeline and see the average of every photo from that range.

- live preview updates while you drag, high-res version replaces it ~1/3 of a second after you stop

## Setup

Needs Node 18+ and Python 3 with Pillow.

```bash
npm install
pip install pillow            # add pillow-heif for iPhone .heic files

# 1. preprocess your photos (re-run whenever the collection changes)
python3 scripts/preprocess.py /path/to/your/photos

# 2. start the site
npm run dev
```

To try it without your own photos, generate a synthetic set first:

```bash
python3 scripts/make_test_photos.py test-photos
python3 scripts/preprocess.py test-photos
```

`npm run build` makes a static site in `dist/`, with the photo data included, that you can
host anywhere (GitHub Pages, Netlify, etc.).

## How it works

**`scripts/preprocess.py`** runs locally. It:

- reads the EXIF capture time (and GPS) and applies the EXIF rotation.
  Photos with no EXIF date fall back to the file's modification time; the header
  shows how many.
- lays every photo out on a shared **maximum canvas**. Each photo is scaled to a common
  short side and centered; the canvas is the largest width × largest height. Mixed
  portrait/landscape sets give a square canvas.
- writes `public/data/hires/<id>.jpg`: each photo upright and resized, for the high-res
  tier. These are reusable pixel data for other experiments.
- packs small copies into `public/data/atlas-N.jpg` sheets for the live preview.
- writes `public/data/photos.json` with every photo's date, GPS, original size,
  canvas position, and where its pixels live.

Options: `--preview-long 512`, `--hires-long 2000`, `--hires-format png` (lossless),
`--quality 90`. Run with `-h` for all options.

**`src/gl/averager.ts`** is the GPU part, in plain WebGL2 with no dependencies:

- Each photo is drawn into a 32-bit float buffer with additive blending, as
  `(color × w, w)`. `w` is 1 inside the photo, fades over a 3% feather at its edges, and is
  nothing outside it. The result is `Σ color·w / Σ w`, so every pixel averages only the photos
  covering it. Pixels with no coverage stay transparent and show as a checkerboard.
- **Live preview tier:** all photos stay on the GPU in the atlases, so a full re-average
  takes about 1 ms.
- **High-res tier:** after 350 ms without changes, each selected photo's high-res file is
  streamed in (4 at a time), added to the sum, and released. Only the sum stays in GPU
  memory, so resolution doesn't limit how many photos you can include. Any new
  selection cancels the pass immediately.
- _Linear-light average_ (header toggle) averages light intensity instead of raw
  pixel values.
- _Download PNG_ saves whatever is on screen at full resolution, with transparent
  uncovered areas.

**`src/store.ts`** (Zustand) holds the one shared selection. The timeline writes to it and
the average view reads from it. A new view (map, mosaic, tag filter) plugs in the same
way: add its filter field to the store and include it in `computeSelection()`.

**`src/components/Timeline.tsx`**: React draws the monthly bars; D3 supplies the scales and
the brush, which snaps to whole years or months. Year buttons: click to select, Shift-click
to extend. With the timeline focused, ←/→ steps the range and Esc clears it.

## Tuning

| Setting                 | Where                                                 | Notes                                                                                                   |
| ----------------------- | ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| Preview resolution      | `--preview-long`                                      | 512 uses ~0.8 MB of GPU memory per photo; 768 uses ~1.8 MB. Fine up to 1,000 photos on a laptop at 512. |
| High-res resolution     | `--hires-long`                                        | Only one photo plus the sum is in memory at a time, so 3000+ is OK; it only changes download time.      |
| Feather width           | `new Averager(..., { feather })` in `AverageView.tsx` | Fraction of the canvas's short side; 0 gives hard edges.                                                |
| Refine delay / prefetch | same options object                                   | `refineDelay` (ms), `prefetch` (images in flight).                                                      |

## Browser support

Needs WebGL2 with float render targets (`EXT_color_buffer_float`). Current desktop Chrome,
Edge, Firefox and Safari all qualify. Without `EXT_float_blend` (some phones), it falls back to
16-bit floats and shows a warning, because large averages may band.
