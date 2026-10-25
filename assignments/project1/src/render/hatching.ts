/**
 * Hatching for shading/contour
 * Draw regular short strokes ACROSS the ribbon (along the normal)
 * Start from whichever edge is turned away from the light, reach inward only as far as the surface is dark
 *
 * Call this while ribbon polygon is set as clip region to keep edges in
 */
import { hash01, noise1 } from "./noise";
import { normalOf, tangentOf, type Ribbon } from "./ribbon";

const STEPS = 8; // how many samples we walk across half the ribbon
const THRESH = 0.55; // darkness above this gets hatched
const ELEV = 0.55; // light elevation above the page (rad). Higher = flatter, brighter
const SIN_E = Math.sin(ELEV);
const COS_E = Math.cos(ELEV);

/**
 * Fake lighting for a tube seen from above.
 * @param {number} v  - position across the ribbon: -1 (-normal edge), 0 (spine), +1 (+normal edge)
 * @param {number} nl - dot(normal light direction on the page) at this spot along the spine
 *
 * Cylinder's surface normal at v = (normal*v, sqrt(1-v^2))
 * 3D light vector =  (lightDir x cosE, sinE)
 * @return {number} - 0: lit, 1 - dark
 */
function darkness(v: number, nl: number): number {
  const lit = v * nl * COS_E + Math.sqrt(Math.max(0, 1 - v * v)) * SIN_E;
  return 1 - Math.min(1, Math.max(0, lit));
}

export function hatchRibbon(
  ctx: CanvasRenderingContext2D,
  r: Ribbon,
  o: { light: number; unit: number; px: number; seed: number },
) {
  // Direction TOWARD the light angle on the page
  const Lx = Math.cos(o.light);
  const Ly = Math.sin(o.light);

  const { spine, width } = r;
  const step = spine.length > 1 ? spine[1].s - spine[0].s : 4;
  const stride = Math.max(1, Math.round((6 * o.unit) / step)); // samples between hatches

  ctx.beginPath(); // all hatches go into ONE path, stroked once (much faster)

  for (
    let i = 0;
    i < spine.length;
    i += stride + (hash01(i, o.seed) > 0.75 ? 1 : 0)
  ) {
    // ^ every so often skip an extra sample, so spacing isn't machine-regular
    const w = width[i];
    if (w < 2 * o.unit) continue; // too thin to hatch (near the tip)

    const p = spine[i];
    const n = normalOf(p);
    const t = tangentOf(p);
    const half = w / 2;
    const nl = n.x * Lx + n.y * Ly; // >0: +normal side faces the light

    // Try both edges. Each one hatches inward while the surface is still dark.
    for (const side of [1, -1]) {
      let reach = 0; // how far in from this edge (0-1 of the half-width) is dark
      for (let k = 1; k <= STEPS; k++) {
        const v = side * (1 - k / STEPS);
        if (darkness(v, nl) < THRESH) break;
        reach = k / STEPS;
      }
      if (reach === 0) continue; // this edge is lit: no hatching here

      // Alter length so hatch ends don't form a clean line
      reach = Math.min(1, reach * (1 + 0.25 * noise1(i * 0.9, o.seed + side)));

      const slant = 0.5 * half * reach; // lean strokes along the curve, like a right-handed hand
      // start slightly outside the edge, end inside
      const ox = p.x + n.x * side * half * 1.15;
      const oy = p.y + n.y * side * half * 1.15;
      const ix = p.x + n.x * side * half * (1 - reach) + t.x * slant;
      const iy = p.y + n.y * side * half * (1 - reach) + t.y * slant;
      ctx.moveTo(ox, oy);
      ctx.lineTo(ix, iy);
    }
  }

  ctx.lineWidth = 0.9 * o.px;
  ctx.lineCap = "round";
  ctx.stroke();
}

/** */

/**
 * How far in from an edge the surface is dark, as a fraction (0–1) of the half-width.
 * Same edge-walk as hatchRibbon uses, pulled out so other hatch styles can share it.
 * @param nl   dot(normal, light direction) at this spot on the spine
 * @param side +1 for the +normal edge, -1 for the -normal edge
 */
function darkReach(nl: number, side: number): number {
  let reach = 0;
  for (let k = 1; k <= STEPS; k++) {
    if (darkness(side * (1 - k / STEPS), nl) < THRESH) break;
    reach = k / STEPS;
  }
  return reach;
}

const MAX_LINES = 20;

/**
 * Contour hatching,
 * Groups of longer parallel strokes that run ALONG the ribbon
 *
 * Each stroke follows the curve at a fixed position v across the width, so it bends with the
 * ribbon and tapers with it. Strokes are bundled into groups spaced along the spine:
 *
 * outer line: longest; inner lines: shorter and staggered
 *
 * Call this with the ribbon polygon set as the clip region
 */
export function hatchToContour(
  ctx: CanvasRenderingContext2D,
  r: Ribbon,
  o: { light: number; unit: number; px: number; seed: number },
) {
  const Lx = Math.cos(o.light);
  const Ly = Math.sin(o.light);
  const { spine, width } = r;
  if (spine.length < 4) return;

  const step = spine[1].s - spine[0].s;
  // Convert a length in "nominal" world units into a number of spine samples
  const toSamples = (len: number) =>
    Math.max(2, Math.round((len * o.unit) / step));

  // Light-facing amount at each sample, computed once (dot of normal and light direction)
  const nl = spine.map((p) => {
    const n = normalOf(p);
    return n.x * Lx + n.y * Ly;
  });

  ctx.beginPath(); // everything goes into ONE path, stroked once

  let g = 0; // group counter, used to seed variation
  let i = 0; //Math.floor(hash01(0, o.seed) * toSamples(20)); // random start so groups don't line up at s=0

  while (i < spine.length - 2) {
    // Each group covers a stretch of the spine
    const len = toSamples(80 + 80 * hash01(g, o.seed + 1)); // group length in samples
    console.log("hatch group length: ", len);
    const i0 = i; // start of the group
    const i1 = Math.min(spine.length - 1, i + len); // end of the group
    const mid = (i0 + i1) >> 1; // middle sample of the group, used to decide which edge is dark

    for (const side of [1, -1]) {
      // Decide the group's size from the darkness at its middle
      const reach = darkReach(nl[mid], side);
      const halfMid = width[mid] / 2;
      if (reach < 0.12 || halfMid < 1.5 * o.unit) continue; // lit, or too thin: no group here

      // More lines where the dark band is wider (about one line per 2.2 units)
      const lines = 6; /* Math.min(
        MAX_LINES,
        1 + Math.floor((reach * halfMid) / (2.2 * o.unit)),
      );*/

      // Draw each line as a stroke along the spine, at a fixed position across the width
      for (let j = 0; j < lines; j++) {
        // Position across the ribbon: j=0 hugs the edge, higher j sits further inward
        const v = side * (1 - (reach * (j + 2)) / lines);

        // Inner lines start later and end earlier, plus random trimming
        const a =
          i0 +
          Math.round(
            j * len * 0.12 + hash01(g * 7 + j, o.seed + side) * len * 0.1,
          );
        const b =
          i1 -
          Math.round(
            j * len * 0.12 + hash01(g * 11 + j, o.seed + side + 5) * len * 0.1,
          );
        if (b - a < 2) continue;

        // Walk along the spine
        // Pen lifts wherever the surface is lit or too thin so strokes end naturally where light is
        let down = false;
        for (let k = a; k <= b; k++) {
          const hw = width[k] / 2;
          if (hw < o.unit || darkness(v, nl[k]) < THRESH) {
            down = false;
            continue;
          }
          const n = normalOf(spine[k]);
          // Calculate distance from the spine (v × half-width) and add hand wobble
          const off =
            v * hw +
            noise1(k * 0.2, o.seed + j * 13 + side * 7) * 0.35 * o.unit;
          //console.log("offset: ", off);
          const x = spine[k].x + n.x * off;
          const y = spine[k].y + n.y * off;
          if (down) ctx.lineTo(x, y);
          else {
            ctx.moveTo(x, y);
            down = true;
          }
        }
      }
    }

    // Gap before the next group (also varied)
    i = i + 10; // i1 + toSamples(12 + 30 * hash01(g, o.seed + 2));
    g++;
  }

  ctx.lineWidth = 0.8 * o.px;
  ctx.lineCap = "round";
  ctx.stroke();
}
