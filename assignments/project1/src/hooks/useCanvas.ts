import { useCallback, useEffect, useRef } from "react";

type DrawFn = (ctx: CanvasRenderingContext2D, w: number, h: number) => void;

/**
 * Render-on-demand canvas hook: handles DPR + resize, coalesces redraws into one rAF (requestAnimationFrame)
 * @param {DrawFn} draw -
 * @returns {{<HTMLCanvasElement>, function}} Canvas ref and requestRedraw callback
 */
export function useCanvas(draw: DrawFn) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drawRef = useRef(draw);
  drawRef.current = draw; // always call the latest draw fn
  const raf = useRef(0);

  const requestRedraw = useCallback(() => {
    if (raf.current) return;
    raf.current = requestAnimationFrame(() => {
      raf.current = 0;
      const canvas = canvasRef.current;
      if (!canvas) return;

      // Calculate DPR, dimensions of canvas
      const dpr = window.devicePixelRatio || 1;
      const { width, height } = canvas.getBoundingClientRect();
      const pw = Math.round(width * dpr),
        ph = Math.round(height * dpr);
      if (canvas.width !== pw || canvas.height !== ph) {
        canvas.width = pw;
        canvas.height = ph;
      }
      const ctx = canvas.getContext("2d")!;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      drawRef.current(ctx, width, height);
    });
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current!;
    const ro = new ResizeObserver(requestRedraw);
    ro.observe(canvas);
    requestRedraw();
    return () => {
      ro.disconnect();
      cancelAnimationFrame(raf.current);
      raf.current = 0;
    };
  }, [requestRedraw]);

  return { canvasRef, requestRedraw };
}
