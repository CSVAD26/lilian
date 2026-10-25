import type { Sample } from "./types";

/** Function defining curvature (how sharply curve turns) as a function of arc length
 * It's the derivative of a curve function
 * @return {number} turn rate in radians per unit of distance
 */
export type Kappa = (s: number) => number;

/**
 * Integrate curvature into a curve:  theta' = kappa,  (x,y)' = (cos, sin)(theta).
 * Smooth by construction (no kinks), so offset ribbons behave later.
 * @param {Kappa} kappa - curvature
 * @param {number} length - length of ??
 * @param origin - origin point (x,y,theta)
 * @param step - size of step between samples (higher means lower res)
 * @return {Sample[]} - array of Sample points defining the curve
 */
export function curveFromCurvature(
  kappa: Kappa,
  length: number,
  origin: { x: number; y: number; th: number },
  step = 4,
): Sample[] {
  const pts: Sample[] = [];
  let { x, y, th } = origin;
  for (let s = 0; s <= length; s += step) {
    pts.push({ x, y, th, s }); // record where we are, which way we face, how far we've come
    th += kappa(s) * step; // turn by (turn rate) × (distance covered)
    x += Math.cos(th) * step; // move `step` units in the new heading
    y += Math.sin(th) * step;
  }
  return pts;
}

/**
 * Sine curve
 * @param {number} n - number of alternating bends
 * @param {number} swing - the peak heading deviation in radians (~1 = a clear S)
 * @param {number} length -
 * @param taper - set in [0,2] shrinks later bends for asymmetry
 * @param phase - phase of wave
 * @return {Kappa} -
 */
export function sineBends(
  n: number,
  swing: number,
  length: number,
  taper = 0,
  phase = 0,
): Kappa {
  const w = (2 * Math.PI * n) / length;
  return (s) =>
    swing * w * Math.cos(w * s + phase) * (1 - taper * (s / length));
}

/** Clothoid tail: curvature ramps up linearly over the last `frac` of the curve. */
export function hookTail(length: number, frac: number, turn: number): Kappa {
  const len = length * frac;
  const start = length - len;
  const rate = (2 * turn) / (len * len); // total turning = rate * len^2 / 2
  return (s) => (s > start ? (s - start) * rate : 0);
}

/** Gaussian bump of curvature: a deliberate, localized turn. */
export function bump(center: number, width: number, amount: number): Kappa {
  return (s) => amount * Math.exp(-((s - center) ** 2) / (2 * width * width));
}

export const addKappa =
  (...ks: Kappa[]): Kappa =>
  (s) =>
    ks.reduce((sum, k) => sum + k(s), 0);

// Get curve samples from any array of points (for user-drawn input)
export function samplesFromStroke(raw: Pt[], step = 2): Sample[] {
  // Smooth: a few passes of a 3-point moving average (keep the endpoints)
  let p = raw;
  for (let pass = 0; pass < 3; pass++) {
    p = p.map((q, i) => {
      if (i === 0 || i === p.length - 1) return q;
      return {
        x: (p[i - 1].x + q.x + p[i + 1].x) / 3,
        y: (p[i - 1].y + q.y + p[i + 1].y) / 3,
      };
    });
  }

  // Resample at even spacing by walking along the polyline
  const out: Pt[] = [p[0]];
  let carry = 0; // distance since the last output point
  for (let i = 1; i < p.length; i++) {
    let a = p[i - 1];
    const b = p[i];
    let segLen = Math.hypot(b.x - a.x, b.y - a.y);
    while (carry + segLen >= step) {
      const u = (step - carry) / segLen;
      a = { x: a.x + (b.x - a.x) * u, y: a.y + (b.y - a.y) * u };
      out.push(a);
      segLen = Math.hypot(b.x - a.x, b.y - a.y);
      carry = 0;
    }
    carry += segLen;
  }

  // Compute heading and arc length for each point
  return out.map((q, i) => {
    const next = out[Math.min(i + 1, out.length - 1)];
    const prev = out[Math.max(i - 1, 0)];
    return {
      x: q.x,
      y: q.y,
      th: Math.atan2(next.y - prev.y, next.x - prev.x),
      s: i * step,
    };
  });
}
