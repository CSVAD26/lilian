/** Seeded RNG (mulberry32). All randomness in core/ goes through this. */
export interface Rng {
  next(): number;
  range(min: number, max: number): number;
  int(min: number, max: number): number; // inclusive
  gauss(): number;
  pick<T>(arr: readonly T[]): T;
}

export function mulberry32(seed: number): Rng {
  let a = seed >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    next,
    range: (min, max) => min + (max - min) * next(),
    int: (min, max) => min + Math.floor(next() * (max - min + 1)),
    gauss: () => Math.sqrt(-2 * Math.log(1 - next())) * Math.cos(2 * Math.PI * next()),
    pick: (arr) => arr[Math.floor(next() * arr.length)],
  };
}
