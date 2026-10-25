/**
 * Layer 1: ribbons
 * A spine (list of Samples) becomes a tapered closed shape by pushing points left and right of the spine along its normal.
 */

import type { Curve, Pt, Sample } from "../core/types";
import { noise1 } from "./noise";

// Unit vector pointing along the curve (heading th)
export const tangentOf = (p: { th: number }): Pt => ({
  x: Math.cos(p.th),
  y: Math.sin(p.th),
});

// Unit vector perpendicular to the curve (the tangent rotated 90deg)
export const normalOf = (p: { th: number }): Pt => ({
  x: -Math.sin(p.th),
  y: Math.cos(p.th),
});

// Full width of the ribbon at its base, by level: main, branch, twig
const BASE_WIDTH = [22, 11, 5];

export interface Ribbon {
  spine: Sample[];
  width: number[]; // full width at each spine sample
  left: Pt[]; // edge on the +normal side
  right: Pt[]; // edge on the −normal side
}

/**
 * @param seed  randomizes swelling/jitter per curve
 * @param unit  scale factor (default is 1 for 800-unit-long main curve) so ribbons stay proportional for different lengths curves
 */
export function buildRibbon(c: Curve, seed: number, unit: number): Ribbon {
  const spine = c.pts;
  const length = spine[spine.length - 1].s || 1;
  console.log(length);
  const base = (BASE_WIDTH[c.level] ?? 3) * unit;

  const width: number[] = [];
  const left: Pt[] = [];
  const right: Pt[] = [];

  for (const p of spine) {
    const midpoint = length / 2;
    const u =
      c.level === 0
        ? Math.abs(p.s - midpoint) / midpoint // main curve base width - 0 at both ends, 1 in the middle
        : p.s / length; // base width - 0 at the root → 1 at the tip

    // Width profile = base x taper x swell
    const taper = Math.pow(1 - u, 0.8); // thins to a point at the tip
    const swell = 1 + 0.18 * noise1(p.s / (40 * unit), seed); // slow organic thick/thin
    const w = Math.max(0, base * taper * swell);

    // Fast, small edge tremble (independent per side)
    const fade = Math.min(1, w / (3 * unit));
    const jl = noise1(p.s / (6 * unit), seed + 1) * 0.4 * unit * fade;
    const jr = noise1(p.s / (6 * unit), seed + 2) * 0.4 * unit * fade;

    const n = normalOf(p);
    width.push(w);
    left.push({ x: p.x + n.x * (w / 2 + jl), y: p.y + n.y * (w / 2 + jl) });
    right.push({ x: p.x - n.x * (w / 2 + jr), y: p.y - n.y * (w / 2 + jr) });
  }
  return { spine, width, left, right };
}

// Trace the closed outline as the current path (left edge forward, right edge back)
export function tracePolygon(ctx: CanvasRenderingContext2D, r: Ribbon) {
  ctx.beginPath();
  r.left.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
  for (let i = r.right.length - 1; i >= 0; i--)
    ctx.lineTo(r.right[i].x, r.right[i].y);
  ctx.closePath();
}

/**
 * Draw many short segments to simulate pen pressure
 *
 * @param px      size of one screen pixel in world units
 * @param wobble  how far points are pushed off the true edge
 * @param weight  nominal line thickness in screen pixels
 */
export function inkEdge(
  ctx: CanvasRenderingContext2D,
  pts: Pt[],
  o: { seed: number; px: number; wobble: number; weight: number },
) {
  // Displace each point by smooth noise so line drifts like real pen
  const d = pts.map((p, i) => ({
    x: p.x + noise1(i * 0.3, o.seed) * o.wobble,
    y: p.y + noise1(i * 0.3, o.seed + 99) * o.wobble,
  }));

  ctx.lineCap = "round";
  for (let i = 1; i < d.length; i++) {
    const pressure = 0.7 + (0.45 * (noise1(i * 0.1, o.seed + 7) + 1)) / 2; // 0.7-1.15
    ctx.lineWidth = o.weight * o.px * pressure;
    ctx.beginPath();
    ctx.moveTo(d[i - 1].x, d[i - 1].y);
    ctx.lineTo(d[i].x, d[i].y);
    ctx.stroke();
  }
}
