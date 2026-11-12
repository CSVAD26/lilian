import { useEffect, useState } from "react";
import { AverageView } from "./components/AverageView";
import { Timeline } from "./components/Timeline";
import { useStore } from "./store";
import type { Manifest } from "./types";

export function App() {
  const setManifest = useStore((s) => s.setManifest);
  const manifest = useStore((s) => s.manifest);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    fetch(`${import.meta.env.BASE_URL}data/photos.json`)
      .then((r) => {
        if (!r.ok) throw new Error(`photos.json not found (${r.status})`);
        return r.json() as Promise<Manifest>;
      })
      .then(setManifest)
      .catch((e) => setLoadError(String(e.message ?? e)));
  }, [setManifest]);

  if (loadError) {
    return (
      <div className="mx-auto my-[15vh] max-w-[560px] px-5 text-secondary">
        <h1 className="text-xl text-foreground">No photo data yet</h1>
        <p>{loadError}</p>
        <p>
          Run{" "}
          <code className="rounded bg-surface px-1.5 py-0.5 text-foreground">
            python3 scripts/preprocess.py /path/to/your/photos
          </code>{" "}
          from the project folder, then reload.
        </p>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col bg-background font-sans text-foreground">
      <Header />
      <div className="flex flex-grow">
        <div className="relative w-160 h-full min-h-0 px-5 pt-4 pb-2">
          {manifest && <AverageView />}
        </div>
        <div className="border-b border-border px-5 pt-1 pb-4">
          <Timeline />
        </div>
      </div>
    </div>
  );
}

function Header() {
  const photos = useStore((s) => s.photos);
  const selected = useStore((s) => s.selected);
  const range = useStore((s) => s.range);
  const snap = useStore((s) => s.snap);
  const setSnap = useStore((s) => s.setSnap);
  const linear = useStore((s) => s.linear);
  const setLinear = useStore((s) => s.setLinear);
  const fileDated = photos.filter((p) => p.dateSource === "file").length;

  return (
    <header className="flex items-center justify-between gap-4 border-b border-border px-5 py-3.5 max-[720px]:flex-col max-[720px]:items-start">
      <div>
        <h1 className="m-0 text-base font-semibold tracking-[0.01em]">
          Self Portrait
        </h1>
        <p className="mt-0.5 mb-0 text-[13px] tabular-nums text-secondary">
          {selected.length} of {photos.length} photos · {describeRange(range)}
          {fileDated > 0 && (
            <span className="text-muted">
              {" "}
              · {fileDated} dated by file time (no EXIF)
            </span>
          )}
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-4">
        <div className="segmented" role="group" aria-label="Brush snaps to">
          <span className="label">Snap</span>
          {(["year", "month"] as const).map((s) => (
            <button
              key={s}
              className={snap === s ? "active" : ""}
              onClick={() => setSnap(s)}
            >
              {s === "year" ? "Year" : "Month"}
            </button>
          ))}
        </div>
        <label
          className="toggle"
          title="Average light intensities (gamma-decoded) instead of raw pixel values; usually a little brighter"
        >
          <input
            className="toggle-input"
            type="checkbox"
            checked={linear}
            onChange={(e) => setLinear(e.target.checked)}
          />
          Linear-light average
        </label>
      </div>
    </header>
  );
}

function describeRange(range: [number, number] | null): string {
  if (!range) return "all dates";
  const s = new Date(range[0]);
  const e = new Date(range[1] - 1);
  const wholeYears =
    s.getMonth() === 0 &&
    s.getDate() === 1 &&
    e.getMonth() === 11 &&
    e.getDate() === 31;
  if (wholeYears)
    return s.getFullYear() === e.getFullYear()
      ? `${s.getFullYear()}`
      : `${s.getFullYear()}–${e.getFullYear()}`;
  const fmt = (d: Date) =>
    d.toLocaleDateString(undefined, { month: "short", year: "numeric" });
  return fmt(s) === fmt(e) ? fmt(s) : `${fmt(s)} – ${fmt(e)}`;
}
