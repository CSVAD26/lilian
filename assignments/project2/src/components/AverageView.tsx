import { useEffect, useRef, useState } from "react";
import { Averager, type AveragerStatus } from "../gl/averager";
import { useStore } from "../store";

const DATA_URL = `${import.meta.env.BASE_URL}data/`;

export function AverageView() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const averagerRef = useRef<Averager | null>(null);
  const manifest = useStore((s) => s.manifest);
  const selected = useStore((s) => s.selected);
  const linear = useStore((s) => s.linear);
  const [ready, setReady] = useState(false);
  const [status, setStatus] = useState<AveragerStatus>({
    phase: "loading",
    count: 0,
  });

  // Create the GPU averager once the manifest is loaded.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!manifest || !canvas) return;
    let averager: Averager;
    try {
      averager = new Averager(canvas, manifest, DATA_URL);
    } catch (e) {
      setStatus({ phase: "error", count: 0, message: (e as Error).message });
      return;
    }
    averager.onStatus = setStatus;
    averagerRef.current = averager;
    let cancelled = false;
    averager.resize();
    averager
      .init()
      .then(() => !cancelled && setReady(true))
      .catch(
        (e) =>
          !cancelled &&
          setStatus({
            phase: "error",
            count: 0,
            message: String(e?.message ?? e),
          }),
      );

    const ro = new ResizeObserver(() => averager.resize());
    ro.observe(canvas);
    return () => {
      cancelled = true;
      ro.disconnect();
      averager.destroy();
      averagerRef.current = null;
      setReady(false);
    };
  }, [manifest]);

  useEffect(() => {
    if (ready) averagerRef.current?.setSelection(selected);
  }, [ready, selected]);

  useEffect(() => {
    if (ready) averagerRef.current?.setLinear(linear);
  }, [ready, linear]);

  const download = async () => {
    const blob = await averagerRef.current?.exportPNG();
    if (!blob) return;
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `average-${status.count}-photos-${status.width}x${status.height}.png`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  };

  return (
    <div className="relative flex w-full h-full flex-col gap-2">
      {/* Image canvas */}
      <canvas ref={canvasRef} className="average-canvas" />

      {/* Status bar */}
      <div className="average-status">
        <StatusLine status={status} />
        <button
          className="btn"
          onClick={download}
          disabled={
            !ready || status.phase === "empty" || status.phase === "loading"
          }
          title="Download the image currently shown as a PNG"
        >
          Download PNG
        </button>
      </div>
    </div>
  );
}

function StatusLine({ status }: { status: AveragerStatus }) {
  const res = status.width ? `${status.width}×${status.height}` : "";
  let text: string;
  let progress: number | null = null;
  switch (status.phase) {
    case "loading":
      text = status.total
        ? `Loading preview atlases ${status.done}/${status.total}…`
        : "Loading…";
      progress = status.total ? (status.done ?? 0) / status.total : null;
      break;
    case "empty":
      text = "No photos in this range";
      break;
    case "preview":
      text = `Live preview · ${res}`;
      break;
    case "refining":
      text = `Preview ${res} · refining ${status.done}/${status.total}`;
      progress = status.total ? (status.done ?? 0) / status.total : null;
      break;
    case "hires":
      text = `High-res · ${res}`;
      break;
    case "error":
      text = `Error: ${status.message}`;
      break;
  }
  return (
    <div className="status-line">
      <span className={`status-dot status-${status.phase}`} aria-hidden />
      <span>{text}</span>
      {progress !== null && (
        <span
          className="progress"
          role="progressbar"
          aria-valuenow={Math.round(progress * 100)}
        >
          <span style={{ width: `${progress * 100}%` }} />
        </span>
      )}
      {status.warning && <span className="warning">⚠ {status.warning}</span>}
    </div>
  );
}
