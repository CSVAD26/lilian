/**
 * Timeline: photos per month as bars, brush snaps to whole years/months
 * Dragging brush updates shared selection live; average view follows it.
 *
 * React renders bars and labels; D3 provides scales, time intervals and brush interaction
 */
import * as d3 from "d3";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent,
} from "react";
import { useStore } from "../store";

const HEIGHT = 120; // height of bar chart, including axis and labels
const M = { top: 10, right: 16, bottom: 26, left: 36 }; // margins for axis and labels

interface Bin {
  start: Date;
  end: Date;
  count: number;
}

export function Timeline() {
  const photos = useStore((s) => s.photos);
  const range = useStore((s) => s.range);
  const snap = useStore((s) => s.snap);
  const setRange = useStore((s) => s.setRange);

  const wrapRef = useRef<HTMLDivElement>(null);
  const brushRef = useRef<SVGGElement>(null);
  const brushBehavior = useRef<d3.BrushBehavior<unknown> | null>(null);
  const brushing = useRef(false);
  const [width, setWidth] = useState(0);
  const [hover, setHover] = useState<{ x: number; bin: Bin } | null>(null);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setWidth(e.contentRect.width));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Monthly bins and yearly totals over whole years spanning the data
  const model = useMemo(() => {
    if (!photos.length) return null;
    const t0 = d3.timeYear.floor(new Date(photos[0].time));
    const t1 = d3.timeYear.offset(
      d3.timeYear.floor(new Date(photos[photos.length - 1].time)),
      1,
    );
    const byMonth = d3.rollup(
      photos,
      (v) => v.length,
      (p) => +d3.timeMonth.floor(new Date(p.time)),
    );
    const byYear = d3.rollup(
      photos,
      (v) => v.length,
      (p) => +d3.timeYear.floor(new Date(p.time)),
    );
    const months: Bin[] = d3.timeMonth.range(t0, t1).map((m) => ({
      start: m,
      end: d3.timeMonth.offset(m, 1),
      count: byMonth.get(+m) ?? 0,
    }));
    const years: Bin[] = d3.timeYear.range(t0, t1).map((y) => ({
      start: y,
      end: d3.timeYear.offset(y, 1),
      count: byYear.get(+y) ?? 0,
    }));
    return { t0, t1, months, years, max: d3.max(months, (b) => b.count) ?? 1 };
  }, [photos]);

  const x = useMemo(
    () =>
      model
        ? d3
            .scaleTime()
            .domain([model.t0, model.t1])
            .range([M.left, Math.max(M.left + 1, width - M.right)])
        : null,
    [model, width],
  );
  const y = useMemo(
    () =>
      model
        ? d3
            .scaleLinear()
            .domain([0, model.max])
            .nice()
            .range([HEIGHT - M.bottom, M.top])
        : null,
    [model],
  );

  // D3 brush, snapping to the chosen interval
  useEffect(() => {
    const node = brushRef.current;
    if (!model || !x || !node || width <= 0) return;
    const g = d3.select<SVGGElement, unknown>(node);
    const interval = snap === "year" ? d3.timeYear : d3.timeMonth;
    const brush = d3
      .brushX<unknown>()
      .extent([
        [M.left, M.top],
        [width - M.right, HEIGHT - M.bottom],
      ])
      .on("start brush end", (ev: d3.D3BrushEvent<unknown>) => {
        if (!ev.sourceEvent) return; // ignore programmatic moves
        brushing.current = ev.type !== "end";
        const sel = ev.selection as [number, number] | null;
        if (!sel) {
          setRange(null);
          return;
        }
        const a = x.invert(sel[0]);
        const b = x.invert(sel[1]);
        let s = interval.floor(a);
        let e = interval.ceil(b);
        if (+e <= +s) e = interval.offset(s, 1);
        s = new Date(Math.max(+s, +model.t0));
        e = new Date(Math.min(+e, +model.t1));
        setRange([+s, +e]);
        if (ev.type === "end") g.call(brush.move, [x(s), x(e)]);
      });
    g.call(brush);
    brushBehavior.current = brush;
    const r = useStore.getState().range;
    g.call(brush.move, r ? [x(r[0]), x(r[1])] : null);
    return () => {
      brush.on("start brush end", null);
      g.selectAll("*").remove();
      g.on(".brush", null);
      brushBehavior.current = null;
    };
  }, [model, x, width, snap, setRange]);

  // Keep the brush in sync when the range changes from elsewhere (year buttons, keys)
  useEffect(() => {
    const node = brushRef.current;
    const brush = brushBehavior.current;
    if (!node || !brush || !x || brushing.current) return;
    const cur = d3.brushSelection(node) as [number, number] | null;
    const target: [number, number] | null = range
      ? [x(range[0]), x(range[1])]
      : null;
    if (!cur && !target) return;
    if (
      cur &&
      target &&
      Math.abs(cur[0] - target[0]) < 0.5 &&
      Math.abs(cur[1] - target[1]) < 0.5
    )
      return;
    d3.select<SVGGElement, unknown>(node).call(brush.move, target);
  }, [range, x]);

  if (!model || !x || !y) return <div ref={wrapRef} className="timeline" />;

  const inRange = (b: Bin) =>
    !range || (+b.start >= range[0] && +b.end <= range[1]);

  const selectYear = (yr: Bin, extend: boolean) => {
    if (extend && range)
      setRange([Math.min(range[0], +yr.start), Math.max(range[1], +yr.end)]);
    else setRange([+yr.start, +yr.end]);
  };

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === "Escape") return setRange(null);
    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
    e.preventDefault();
    const interval = snap === "year" ? d3.timeYear : d3.timeMonth;
    const step = e.key === "ArrowLeft" ? -1 : 1;
    const [s, en] = range ?? [+model.t0, +interval.offset(model.t0, 1)];
    const ns = interval.offset(new Date(s), step);
    const ne = interval.offset(new Date(en), step);
    if (+ns < +model.t0 || +ne > +model.t1) return;
    setRange([+ns, +ne]);
  };

  const onPointerMove = (e: PointerEvent<SVGSVGElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const px = e.clientX - rect.left;
    const t = x.invert(px);
    const bin = model.months.find((b) => t >= b.start && t < b.end);
    setHover(
      bin && px >= M.left && px <= width - M.right ? { x: px, bin } : null,
    );
  };

  const fmtMonth = d3.timeFormat("%B %Y");
  const total = photos.length;

  return (
    <div className="flex flex-col gap-2 pt-2.5">
      {/* Year filter buttons */}
      <div
        className="flex flex-wrap gap-1.5"
        role="group"
        aria-label="Select a year"
      >
        <button
          className={`chip ${range ? "" : "active"}`}
          onClick={() => setRange(null)}
        >
          All <span className="chip-count">{total}</span>
        </button>
        {model.years.map((year) => (
          <button
            key={+year.start}
            className={`chip ${range && inRange(year) ? "active" : ""}`}
            disabled={year.count === 0}
            onClick={(e) => selectYear(year, e.shiftKey)}
            title="Click to select · Shift-click to extend"
          >
            {year.start.getFullYear()}{" "}
            <span className="chip-count">{year.count}</span>
          </button>
        ))}
        <span className="ml-auto text-muted text-xs tabular-nums">
          Drag on the timeline to select time period · ←/→ to step · Esc for all
        </span>
      </div>

      {/* Timeline chart of number of photos over time */}
      <div
        ref={wrapRef}
        className="relative w-full rounded-sm outline-none focus-within:ring-2 focus-within:ring-muted"
        tabIndex={0}
        onKeyDown={onKeyDown}
        aria-label="Timeline of photos per month"
      >
        <svg
          width={width}
          height={HEIGHT}
          onPointerMove={onPointerMove}
          onPointerLeave={() => setHover(null)}
        >
          {/* recessive grid: one baseline + year dividers */}
          <line
            className="axis-line"
            x1={M.left}
            x2={width - M.right}
            y1={y(0)}
            y2={y(0)}
          />
          {model.years.map((yr) => (
            <g key={+yr.start}>
              <line
                className="year-divider"
                x1={x(yr.start)}
                x2={x(yr.start)}
                y1={M.top}
                y2={HEIGHT - M.bottom + 4}
              />
              <text
                className="axis-label"
                x={(x(yr.start) + x(yr.end)) / 2}
                y={HEIGHT - 8}
                textAnchor="middle"
              >
                {yr.start.getFullYear()}
              </text>
            </g>
          ))}
          {y
            .ticks(3)
            .filter((t) => t > 0 && Number.isInteger(t))
            .map((t) => (
              <g key={t}>
                <line
                  className="grid-line"
                  x1={M.left}
                  x2={width - M.right}
                  y1={y(t)}
                  y2={y(t)}
                />
                <text
                  className="axis-label"
                  x={M.left - 6}
                  y={y(t)}
                  dy="0.32em"
                  textAnchor="end"
                >
                  {t}
                </text>
              </g>
            ))}
          {model.months.map((b) => {
            if (!b.count) return null;
            const x0 = x(b.start) + 1;
            const w = Math.max(1, x(b.end) - x(b.start) - 2); // 2px gap between bars
            const top = y(b.count);
            return (
              <path
                key={+b.start}
                className={`bar ${inRange(b) ? "bar-on" : "bar-off"} ${
                  hover?.bin === b ? "bar-hover" : ""
                }`}
                d={roundedTop(x0, top, w, y(0) - top, Math.min(4, w / 2))}
              />
            );
          })}
          <g ref={brushRef} className="brush" />
        </svg>
        {hover && (
          <div className="tooltip" style={{ left: hover.x }}>
            <strong>{fmtMonth(hover.bin.start)}</strong>
            <span>
              {hover.bin.count} photo{hover.bin.count === 1 ? "" : "s"}
            </span>
          </div>
        )}
      </div>
    </div>
  );
}

/** Get SVG path to draw bar for a bin on the chart
 *  Rounded top corners, square at the baseline */
function roundedTop(
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): string {
  r = Math.max(0, Math.min(r, h));
  return `M${x},${y + h}V${y + r}Q${x},${y} ${x + r},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + h}Z`;
}
