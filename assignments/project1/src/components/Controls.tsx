import { ARCHETYPE_NAMES, type ArchetypeName } from "../core/archetypes";
import { useStore } from "../state/store";
//import { exportPng } from "./exportPng";
import type { RenderMode, DrawMode } from "../core/types";

export function Controls() {
  const {
    archetype,
    seed,
    light,
    showJoints,
    scene,
    drawMode,
    renderMode,
    vineColor,
  } = useStore();
  const {
    setArchetype,
    setSeed,
    regenerate,
    setLight,
    setShowJoints,
    setDrawMode,
    setRenderMode,
    setVineColor,
  } = useStore.getState();

  return (
    <aside className="w-full sm:w-64 p-4 flex flex-col gap-3 border-r border-gray-200 bg-gray-50">
      <h1>Spine Growth Tool</h1>

      <div className="flex flex-row flex-wrap items-center gap-2 sm:flex-col">
        <label>
          Archetype
          <select
            value={archetype}
            onChange={(e) => setArchetype(e.target.value as ArchetypeName)}
          >
            {ARCHETYPE_NAMES.map((n) => (
              <option key={n}>{n}</option>
            ))}
          </select>
        </label>

        <label>
          Render Mode
          <select
            value={renderMode}
            onChange={(e) => setRenderMode(e.target.value as RenderMode)}
          >
            <option value="line">Line</option>
            <option value="vine">Vine</option>
            <option value="bone">Bone</option>
          </select>
        </label>

        <label>
          Draw Mode
          <select
            value={drawMode}
            onChange={(e) => setDrawMode(e.target.value as DrawMode)}
          >
            <option value="auto">Auto</option>
            <option value="draw">Draw</option>
          </select>
        </label>

        {drawMode === "auto" && <button onClick={regenerate}>New curve</button>}

        <label>
          Seed
          <input
            className="w-18"
            type="number"
            value={seed}
            onChange={(e) => setSeed(Number(e.target.value) || 0)}
          />
        </label>

        <label>
          Light angle
          <input
            className="w-18"
            type="range"
            min={-Math.PI}
            max={Math.PI}
            step={0.01}
            value={light}
            onChange={(e) => setLight(Number(e.target.value))}
          />
        </label>

        <label className="flex flex-row items-center gap-2">
          <input
            type="checkbox"
            checked={showJoints}
            onChange={(e) => setShowJoints(e.target.checked)}
          />
          Show joints
        </label>

        {/*<button onClick={() => exportPng(scene, light)}>Export PNG</button>*/}

        <p className="text-xs text-gray-600">
          {scene.spines[0]?.curves.length} curves · seed {scene.seed}
        </p>

        <div className="flex flex-row items-center gap-2">
          <label>Color:</label>
          <input
            type="color"
            id="theme-color"
            name="theme-color"
            value={vineColor}
            onChange={(e) => setVineColor(e.target.value)}
          />
        </div>
      </div>
    </aside>
  );
}
