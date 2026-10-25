/**
 * Layer 3b: paper grain.
 * A small random-speckle tile is generated ONCE, then repeated across the canvas
 * with the 'multiply' blend mode so it darkens the drawing slightly, like paper tooth.
 */

const TILE = 160;
let tile: CanvasImageSource | null = null;

function getTile(): CanvasImageSource {
  if (tile) return tile;
  const c: HTMLCanvasElement | OffscreenCanvas =
    typeof OffscreenCanvas !== "undefined"
      ? new OffscreenCanvas(TILE, TILE)
      : Object.assign(document.createElement("canvas"), {
          width: TILE,
          height: TILE,
        });
  const g = c.getContext("2d") as CanvasRenderingContext2D;
  const img = g.createImageData(TILE, TILE);

  // Tiny seeded generator so the grain is identical on every run
  let s = 12345;
  const rand = () =>
    (s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296;

  for (let i = 0; i < img.data.length; i += 4) {
    const v = 205 + rand() * 50; // light grey speckle (205–255)
    img.data[i] = img.data[i + 1] = img.data[i + 2] = v;
    img.data[i + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  tile = c;
  return c;
}

/** Overlay grain on the whole canvas. Call last, after ctx.restore(). */
export function paperGrain(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  strength = 0.35,
) {
  const pattern = ctx.createPattern(getTile(), "repeat");
  if (!pattern) return;
  ctx.save();
  ctx.globalCompositeOperation = "multiply"; // result = drawing x grain (only ever darkens)
  ctx.globalAlpha = strength;
  ctx.fillStyle = pattern;
  ctx.fillRect(0, 0, w, h);
  ctx.restore();
}
