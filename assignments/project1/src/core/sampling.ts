import type { Sample } from "./types";

export const curveLength = (pts: Sample[]) =>
  pts.length ? pts[pts.length - 1].s : 0;

/**
 * Point + heading at arc-length distance d (clamped), linearly interpolated.
 * @param {Sample[]} pts - points
 * @param {number} d - arc length distance (clamped)
 * @return {Sample}
 */
export function pointAtDistance(pts: Sample[], d: number): Sample {
  if (d <= 0) return pts[0];
  if (d >= curveLength(pts)) return pts[pts.length - 1];
  let lo = 0,
    hi = pts.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (pts[mid].s <= d) lo = mid;
    else hi = mid;
  }
  const a = pts[lo],
    b = pts[hi];
  const u = (d - a.s) / (b.s - a.s);
  return {
    x: a.x + (b.x - a.x) * u,
    y: a.y + (b.y - a.y) * u,
    th: a.th + (b.th - a.th) * u,
    s: d,
  };
}

/** Local turning direction at d: +1 / -1 (sign of kappa), 0 if straight. */
export function turnSign(pts: Sample[], d: number, span = 20): number {
  const dth =
    pointAtDistance(pts, d + span).th - pointAtDistance(pts, d - span).th;
  return Math.abs(dth) < 1e-3 ? 0 : Math.sign(dth);
}

// TODO: normalAt(pts, d), resampleByDistance(pts, spacing)  -> needed for ribbons/hatching
