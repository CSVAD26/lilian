export type Range = [number, number];

export interface Archetype {
  mainLength: number;
  bends: Range; // number of S-bends on main flow
  swing: Range; // peak heading deviation per bend (rad)
  taper: number; // 0..1, later bends weaker (asymmetry)
  mainHook: number; // clothoid curl at main tip (rad), 0 = none
  branches: Range; // level-1 branch count
  branchLen: Range; // fraction of parent length
  branchSwing: Range;
  angle: Range; // branch angle off parent tangent (rad)
  outerBias: number; // prob. branch leaves from outer side of a bend
  hookChance: number; // prob. a branch ends in a curl
  clusters: Range; // number of attachment clusters along parent
}

export const ARCHETYPES = {
  simple: {
    mainLength: 800,
    bends: [0.5, 2], // [0.5, 1.5],
    swing: [0.7, 2], // try 10
    taper: 1, // try 10, 100, 1000
    mainHook: 0,
    branches: [2, 6],
    branchLen: [0.18, 0.6],
    branchSwing: [0.5, 1.2],
    angle: [0.4, 0.9],
    outerBias: 0.75,
    hookChance: 0.15,
    clusters: [2, 3],
  },
  idk: {
    mainLength: 800,
    bends: [1, 3], // [0.5, 1.5],
    swing: [0.7, 2], // try 10
    taper: 1, // try 10, 100, 1000
    mainHook: 0,
    branches: [6, 10],
    branchLen: [0.18, 0.4],
    branchSwing: [0.5, 1.2],
    angle: [0.4, 0.9],
    outerBias: 0.75,
    hookChance: 0.15,
    clusters: [2, 3],
  },
  spiralHook: {
    mainLength: 800,
    bends: [1, 2],
    swing: [0.5, 0.9],
    taper: 0.2,
    mainHook: 5,
    branches: [5, 9],
    branchLen: [0.15, 0.35],
    branchSwing: [0.6, 1.3],
    angle: [0.3, 0.8],
    outerBias: 0.6,
    hookChance: 0.5,
    clusters: [2, 3],
  },
  snakes: {
    mainLength: 800,
    bends: [4, 5],
    swing: [1.1, 1.6],
    taper: 0.3,
    mainHook: 0,
    branches: [14, 24],
    branchLen: [0.1, 0.3],
    branchSwing: [1.0, 1.8],
    angle: [0.6, 1.4],
    outerBias: 0.5,
    hookChance: 0.3,
    clusters: [3, 4],
  },
  weird: {
    mainLength: 800,
    bends: [1, 3], // [0.5, 1.5],
    swing: [0.7, 2], // try 10
    taper: 10, // try 10, 100, 1000
    mainHook: 0,
    branches: [6, 10],
    branchLen: [0.18, 0.4],
    branchSwing: [0.5, 1.2],
    angle: [0.4, 0.9],
    outerBias: 0.75,
    hookChance: 0.15,
    clusters: [2, 3],
  },
} satisfies Record<string, Archetype>;

export type ArchetypeName = keyof typeof ARCHETYPES;
export const ARCHETYPE_NAMES = Object.keys(ARCHETYPES) as ArchetypeName[];

// TODO: converge (shared target node), winged (fan bundle), antler (dichotomous forks)
