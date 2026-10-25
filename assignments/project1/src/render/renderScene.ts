import type { Scene } from "../core/types";
import { curveLength } from "../core/sampling";
import { buildRibbon, inkEdge, tracePolygon } from "./ribbon";
import { hatchRibbon, hatchToContour } from "./hatching";
import { paperGrain } from "./paper";
import type { RenderMode } from "../core/types";

export interface RenderOpts {
  w: number;
  h: number;
  light: number; // radians: direction on the page pointing TOWARD the light
  showJoints: boolean;
  padding?: number;
  view?: ViewTransform; // fixed view (draw mode). If omitted, fit the scene to the canvas
  style?: RenderMode;
  vineColor?: string;
}

export interface ViewTransform {
  k: number;
  tx: number;
  ty: number;
}

const PAPER = "#f1ebdd";
const INK = "#1b1a17";
const VINE_COLOR = "#db5353";

// Fit scene bbox into the canvas
export function fitTransform(
  scene: Scene,
  w: number,
  h: number,
  pad = 40,
): ViewTransform {
  let x0 = Infinity,
    y0 = Infinity,
    x1 = -Infinity,
    y1 = -Infinity;
  for (const c of scene.spines[0].curves)
    for (const p of c.pts) {
      x0 = Math.min(x0, p.x);
      y0 = Math.min(y0, p.y);
      x1 = Math.max(x1, p.x);
      y1 = Math.max(y1, p.y);
    }
  const bw = Math.max(1, x1 - x0),
    bh = Math.max(1, y1 - y0);
  const k = Math.min((w - pad * 2) / bw, (h - pad * 2) / bh);
  return { k, tx: (w - bw * k) / 2 - x0 * k, ty: (h - bh * k) / 2 - y0 * k };
}

export function renderScene(
  ctx: CanvasRenderingContext2D,
  scene: Scene,
  o: RenderOpts,
): ViewTransform {
  // Background
  ctx.fillStyle = PAPER;
  ctx.fillRect(0, 0, o.w, o.h);

  if (scene.spines.length === 0) return o.view ?? { k: 1, tx: 0, ty: 0 };

  const v = o.view ?? fitTransform(scene, o.w, o.h, o.padding);
  const px = 1 / v.k; // size of one screen pixel in world units
  // Scale ribbon widths to the main curve's length (800 = the default generator length)
  const unit = curveLength(scene.spines[0].curves[0].pts) / 800;

  ctx.save();
  ctx.translate(v.tx, v.ty);
  ctx.scale(v.k, v.k);
  ctx.lineJoin = "round";

  // Draw curves based on render mode
  if (o.style === "line")
    drawLines(ctx, scene, {
      light: o.light,
      unit,
      px,
      showJoints: o.showJoints,
    });
  else if (o.style === "vine")
    drawRibbonCord(ctx, scene, {
      light: o.light,
      unit,
      px,
      showJoints: o.showJoints,
      vineColor: o.vineColor ?? VINE_COLOR,
    });
  else if (o.style === "bone") {
    // Both for now
    drawRibbonCord(ctx, scene, {
      light: o.light,
      unit,
      px,
      showJoints: o.showJoints,
      vineColor: o.vineColor ?? VINE_COLOR,
      jointColor: o.vineColor,
    });
    drawLines(ctx, scene, {
      light: o.light,
      unit,
      px,
      showJoints: o.showJoints,
    });
  }

  ctx.restore();

  // Add paper grain over everything
  if (o.style !== "line") paperGrain(ctx, o.w, o.h);
  return v;
}

// The ink pipeline: ribbons + hatching + hand-drawn edges
function drawRibbonCord(
  ctx: CanvasRenderingContext2D,
  scene: Scene,
  o: {
    light: number;
    unit: number;
    px: number;
    showJoints: boolean;
    vineColor: string;
    jointColor?: string;
  },
) {
  for (let spine of scene.spines) {
    // Painter's algorithm: draw twigs, then branches, then the main curve last
    // Fill each ribbon with paper colour to hide layers behind it
    const order = [...spine.curves].sort((a, b) => b.level - a.level);

    for (const c of order) {
      if (c.pts.length < 3) continue;
      const seed = (scene.seed * 131 + spine.curves.indexOf(c) * 17) | 0; // unique per curve, stable

      // Build outline from spine
      const ribbon = buildRibbon(c, seed, o.unit);

      // Fill with paper color
      tracePolygon(ctx, ribbon);
      ctx.fillStyle = o.vineColor;
      ctx.fill();

      // Hatching, clipped to the outline (path from tracePolygon is still current)
      ctx.save();
      ctx.clip();
      ctx.strokeStyle = INK;
      ctx.globalAlpha = 0.85;
      hatchToContour(ctx, ribbon, {
        light: o.light,
        unit: o.unit,
        px: o.px,
        seed,
      });
      ctx.restore();

      // Inked edges (two passes with different wobble)
      ctx.strokeStyle = INK;
      for (const edge of [ribbon.left, ribbon.right]) {
        inkEdge(ctx, edge, {
          seed,
          px: o.px,
          wobble: 0.6 * o.unit,
          weight: 1.8,
        });
        ctx.globalAlpha = 0.45;
        inkEdge(ctx, edge, {
          seed: seed + 500,
          px: o.px,
          wobble: 1.4 * o.unit,
          weight: 1.0,
        });
        ctx.globalAlpha = 1;
      }
      // Close the open root end of the main curve (branch roots are hidden by their parent)
      if (c.level === 0)
        inkEdge(ctx, [ribbon.right[0], ribbon.left[0]], {
          seed,
          px: o.px,
          wobble: 0,
          weight: 1.8,
        });
    }

    // TODO: joints
    // Placeholder joints: filled circles
    if (o.showJoints) {
      ctx.strokeStyle = INK;
      ctx.lineWidth = 2; // 4 * o.px;
      const jointSize = 12; // 4 * o.unit;
      for (const j of spine.joints) {
        // Large circle
        ctx.fillStyle = o.jointColor || PAPER;
        ctx.beginPath();
        ctx.arc(j.x, j.y, jointSize, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
        // Small circle
        ctx.fillStyle = INK;
        ctx.beginPath();
        ctx.arc(j.x, j.y, 3 * o.unit, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
      }
    }
  }
}

// Minimal line view, good for tuning silhouettes
function drawLines(
  ctx: CanvasRenderingContext2D,
  scene: Scene,
  o: { light: number; unit: number; px: number; showJoints: boolean },
) {
  const WIDTH = [2.4, 1.5, 0.9];
  ctx.strokeStyle = INK;
  ctx.lineCap = "round";
  for (let spine of scene.spines) {
    for (const c of [...spine.curves].sort((a, b) => b.level - a.level)) {
      ctx.lineWidth = (WIDTH[c.level] ?? 0.7) * o.px;
      ctx.beginPath();
      c.pts.forEach((p, i) =>
        i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y),
      );
      ctx.stroke();
    }

    // TODO: joints
    // Placeholder joints: paper-filled knobs
    if (o.showJoints) {
      ctx.fillStyle = PAPER;
      ctx.strokeStyle = INK;
      ctx.lineWidth = 1.6 * o.px;
      for (const j of spine.joints) {
        ctx.beginPath();
        ctx.arc(j.x, j.y, 4.5 * o.unit, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
      }
    }
  }
}
