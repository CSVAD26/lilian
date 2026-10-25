import { useEffect, useRef } from "react";
import { useStore } from "../state/store";
import { renderScene } from "../render/renderScene";
import { useCanvas } from "../hooks/useCanvas";
import type { Pt } from "../core/types";

export function CanvasView() {
  const {
    scene,
    light,
    showJoints,
    drawMode,
    renderMode,
    vineColor,
    createStroke,
  } = useStore();

  // User drawing vars
  const isMouseDown = useRef(false);
  const currentCurve = useRef<Pt[]>([]);

  const { canvasRef, requestRedraw } = useCanvas((ctx, w, h) => {
    console.log(renderMode);
    renderScene(ctx, scene, {
      w,
      h,
      light,
      showJoints,
      view: drawMode === "draw" ? { k: 1, tx: 0, ty: 0 } : undefined,
      style: renderMode,
      vineColor,
    });

    // live preview of the stroke while the pointer is down
    if (isMouseDown.current && currentCurve.current.length > 1) {
      ctx.strokeStyle = "#1b1a17";
      ctx.lineWidth = 2;
      ctx.lineCap = "round";
      ctx.beginPath();
      currentCurve.current.forEach((p, i) =>
        i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y),
      );
      ctx.stroke();
    }
  });

  useEffect(() => {
    requestRedraw();
  }, [scene, light, showJoints, drawMode, renderMode, vineColor, createStroke]);

  // Calculate mouse position in canvas
  const pos = (e: React.PointerEvent) => {
    const rect = e.currentTarget.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  };

  return (
    <canvas
      className="border-solid border-1 border-gray-200"
      ref={canvasRef}
      style={{ width: "100%", height: "100%" }}
      onPointerDown={(e) => {
        if (drawMode !== "draw") return;
        e.currentTarget.setPointerCapture(e.pointerId);
        isMouseDown.current = true;
        currentCurve.current = [pos(e)];
        requestRedraw();
      }}
      onPointerMove={(e) => {
        if (!canvasRef.current || !isMouseDown.current) return;

        // Draw line if mouse down
        currentCurve.current.push(pos(e));
        requestRedraw();
      }}
      onPointerUp={() => {
        if (!isMouseDown.current) return;
        isMouseDown.current = false;
        console.log(currentCurve.current);
        createStroke(currentCurve.current); // generate new growth from user input stroke
        currentCurve.current = []; // reset curve array
      }}
    />
  );
}
