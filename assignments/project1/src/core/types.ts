// Render settings
export type RenderMode = "line" | "vine" | "bone";
export type DrawMode = "auto" | "draw";

// Point
export interface Pt {
  x: number;
  y: number;
}

// A point on a curve
export interface Sample extends Pt {
  th: number; // heading angle in radians (direction curve is pointing rn)
  s: number; // arc length (distance travelled along curve from start)
}

// A curve
export interface Curve {
  id: string;
  parentId: string | null;
  level: number; // 0 = main flow, 1 = branch, 2 = twig
  attachS: number; // arc-length position on parent (0 for main)
  pts: Sample[];
}

// A group of curves (1 parent + however many children)
export interface Spine {
  curves: Curve[];
  joints: Pt[]; // attachment points (future: joint components)
}

// Plain serializable data
// Renderers consume this, nothing else
export interface Scene {
  seed: number;
  archetype: string;
  spines: Spine[];
}
