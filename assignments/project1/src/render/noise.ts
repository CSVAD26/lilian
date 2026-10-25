/**
 * Deterministic "random" helpers for hand-drawn wobble
 */

// Hash an integer + seed into a repeatable number in [0, 1)
export function hash01(i: number, seed: number): number {
  let h = Math.imul(i | 0, 374761393) ^ Math.imul(seed | 0, 668265263);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/**
 * Smooth 1D "value noise" in [-1, 1].
 * Picks a random value at every integer x and blends between neighbors with a
 * smoothstep curve. Small changes in x give small changes in the result, which
 * is what makes it look like a steady hand rather than static.
 *   noise1(s / 40, seed) -> slow drift (40 units per "wave")
 *   noise1(s / 6,  seed) -> fast tremble
 */
export function noise1(x: number, seed: number): number {
  const i = Math.floor(x);
  const f = x - i;
  const u = f * f * (3 - 2 * f); // smoothstep easing
  const a = hash01(i, seed);
  const b = hash01(i + 1, seed);
  return (a + (b - a) * u) * 2 - 1;
}
