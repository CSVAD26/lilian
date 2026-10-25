import { create } from "zustand";
import { generate } from "../core/generate";
import { samplesFromStroke } from "../core/curves";
import type { ArchetypeName } from "../core/archetypes";
import type { RenderMode, DrawMode, Scene, Pt } from "../core/types";

interface State {
  archetype: ArchetypeName;
  seed: number;
  light: number;
  showJoints: boolean;
  scene: Scene; // derived from (archetype, seed); never mutated
  drawMode: DrawMode; // whether to autogenerate or take user drawing input
  renderMode: RenderMode; // how drawn lines are rendered
  vineColor: string; // color of base vines
  setArchetype: (a: ArchetypeName) => void;
  setSeed: (s: number) => void;
  regenerate: () => void;
  createStroke: (stroke: Pt[]) => void;
  setLight: (l: number) => void;
  setShowJoints: (v: boolean) => void;
  setDrawMode: (m: DrawMode) => void;
  setRenderMode: (m: RenderMode) => void;
  setVineColor: (c: string) => void;
}

const INITIAL_SEED = 69;

export const useStore = create<State>()((set, get) => ({
  archetype: "simple",
  seed: INITIAL_SEED,
  light: -Math.PI / 4,
  showJoints: true,
  scene: {
    seed: INITIAL_SEED,
    archetype: "serpentine",
    spines: [generate("simple", INITIAL_SEED)],
  },
  drawMode: "auto",
  renderMode: "vine",
  vineColor: "#db5353",

  setArchetype: (archetype) =>
    set({
      archetype,
      scene: {
        seed: get().seed,
        archetype: archetype,
        spines: [generate(archetype, get().seed)],
      },
    }),
  setSeed: (seed) =>
    set({
      seed,
      scene: {
        seed: seed,
        archetype: get().archetype,
        spines: [generate(get().archetype, seed)],
      },
    }),
  regenerate: () => {
    const seed = Math.floor(Math.random() * 1_000_000);
    set({
      seed,
      scene: {
        seed: seed,
        archetype: get().archetype,
        spines: [generate(get().archetype, seed)],
      },
    });
  },
  createStroke: (stroke: Pt[]) => {
    // Samples and seed for new spine
    const newMainCurveSamples = samplesFromStroke(stroke);
    const newSeed = Math.floor(Math.random() * 1_000_000);
    set({
      scene: {
        seed: get().seed,
        archetype: get().archetype,
        spines: [
          ...get().scene.spines,
          generate(get().archetype, newSeed, newMainCurveSamples),
        ],
      },
    });
  },
  setLight: (light) => set({ light }),
  setShowJoints: (showJoints) => set({ showJoints }),
  setDrawMode: (mode) => {
    set({
      drawMode: mode,
      scene:
        mode === "auto"
          ? {
              seed: get().seed,
              archetype: get().archetype,
              spines: [generate(get().archetype, get().seed)],
            }
          : {
              seed: get().seed,
              archetype: get().archetype,
              spines: [],
            },
    });
  },
  setRenderMode: (mode: RenderMode) => {
    set({
      renderMode: mode,
    });
  },
  setVineColor: (color: string) => {
    set({
      vineColor: color,
    });
  },
}));
