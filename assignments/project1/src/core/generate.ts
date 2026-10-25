import type { Curve, Pt, Sample } from "./types";
import { mulberry32 } from "./rng";
import { addKappa, curveFromCurvature, hookTail, sineBends } from "./curves";
import { curveLength, pointAtDistance, turnSign } from "./sampling";
import { ARCHETYPES, type Archetype, type ArchetypeName } from "./archetypes";

/** Pure: (archetype, seed) -> Scene data */
export function generate(
  name: ArchetypeName,
  seed: number,
  mainCurveSamples: Sample[] = [],
) {
  const A: Archetype = ARCHETYPES[name];
  const rng = mulberry32(seed);
  const curves: Curve[] = [];
  const joints: Pt[] = [];
  let counter = 0;
  const newId = () => `c${counter++}`;

  // ---- main flow curve ----
  const L = A.mainLength;
  const bends = rng.int(...A.bends);
  const swing = rng.range(...A.swing);
  const kappa = addKappa(
    sineBends(bends, swing, L, A.taper, rng.range(0, Math.PI)),
    A.mainHook
      ? hookTail(L, 0.3, A.mainHook * (rng.next() < 0.5 ? 1 : -1))
      : () => 0,
  );

  // Generate random main curve if not given
  if (mainCurveSamples.length === 0) {
    mainCurveSamples = curveFromCurvature(kappa, L, {
      x: 0,
      y: 0,
      th: rng.range(-0.3, 0.3),
    });
  }
  const main = {
    id: newId(),
    parentId: null,
    level: 0,
    attachS: 0,
    pts: mainCurveSamples,
  };
  curves.push(main);

  // ---- branches (recursive, depth-limited) ----
  function grow(parent: Curve, level: number) {
    const parentLen = curveLength(parent.pts);
    const count = level === 1 ? rng.int(...A.branches) : rng.int(0, 2);
    const nClusters = rng.int(...A.clusters);
    const centers = Array.from({ length: nClusters }, () =>
      rng.range(0.1, 0.9),
    );

    for (let i = 0; i < count; i++) {
      // clustered attachment position -> rhythm instead of even spacing
      const t = Math.min(
        0.97,
        Math.max(0.04, rng.pick(centers) + rng.gauss() * 0.08),
      );
      const d = t * parentLen;
      const p = pointAtDistance(parent.pts, d);

      // outer side of the local bend, with some rule-breakers
      const turn = turnSign(parent.pts, d) || 1;
      const outer = -turn;
      const side = rng.next() < A.outerBias ? outer : -outer;

      // length: strongest around a third along the parent, smaller on twigs
      const bumpFactor = 0.3 + 0.7 * Math.exp(-((t - 0.35) ** 2) / 0.08);
      const levelScale = level === 1 ? 1 : 0.4;
      const len =
        parentLen * rng.range(...A.branchLen) * bumpFactor * levelScale;
      if (len < 30) continue;

      // heading: leave at an angle off the parent tangent
      const th0 = p.th + side * rng.range(...A.angle);

      const n = rng.pick([0.5, 1, 1.5]);
      const curlSign = rng.next() < 0.6 ? side : -side;
      const bSwing = rng.range(...A.branchSwing);
      const k = addKappa(
        sineBends(n, curlSign * bSwing, len),
        rng.next() < A.hookChance
          ? hookTail(len, 0.35, curlSign * rng.range(2, 5))
          : () => 0,
      );

      const child: Curve = {
        id: newId(),
        parentId: parent.id,
        level,
        attachS: d,
        pts: curveFromCurvature(k, len, { x: p.x, y: p.y, th: th0 }, 3),
      };
      curves.push(child);
      joints.push({ x: p.x, y: p.y });
      if (level < 2) grow(child, level + 1);
    }
  }
  grow(main, 1);

  return { curves, joints };
}
