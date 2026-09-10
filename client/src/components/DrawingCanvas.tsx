import { useRef, useEffect, useCallback, useState, forwardRef, useImperativeHandle } from 'react';

export interface Stroke {
  id?: number;
  tool: 'pen' | 'highlighter';
  color: string;
  width: number;
  points: { x: number; y: number; p?: number }[];
}

export interface DrawingCanvasProps {
  width: number;
  height: number;
  rotation?: number;
  strokes: Stroke[];
  layer: 'student' | 'teacher';
  readOnly: boolean;
  tool: 'pen' | 'highlighter' | 'eraser';
  color: string;
  penWidth: number;
  onStrokesChange: (strokes: Stroke[]) => void;
}

export interface DrawingCanvasHandle {
  undo: () => void;
  redo: () => void;
  canUndo: () => boolean;
  canRedo: () => boolean;
  exportCanvas: () => HTMLCanvasElement | null;
}

const DrawingCanvas = forwardRef<DrawingCanvasHandle, DrawingCanvasProps>(
  ({ width, height, rotation = 0, strokes, readOnly, tool, color, penWidth, onStrokesChange }, ref) => {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const ctxRef = useRef<CanvasRenderingContext2D | null>(null);
    const drawingRef = useRef(false);
    const currentStrokeRef = useRef<Stroke | null>(null);
    const strokesRef = useRef<Stroke[]>(strokes);
    const undoStackRef = useRef<Stroke[][]>([]);
    const redoStackRef = useRef<Stroke[][]>([]);
    const [, forceRender] = useState(0);
    const isPencilActiveRef = useRef(false);

    const redraw = useCallback(() => {
      const canvas = canvasRef.current;
      const ctx = ctxRef.current;
      if (!canvas || !ctx) return;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      for (const stroke of strokesRef.current) {
        drawStroke(ctx, stroke, width, height);
      }
      if (currentStrokeRef.current) {
        drawStroke(ctx, currentStrokeRef.current, width, height);
      }
    }, [width, height]);

    useEffect(() => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      canvas.width = width;
      canvas.height = height;
      ctxRef.current = canvas.getContext('2d');
      strokesRef.current = strokes;
      redraw();
    }, [width, height, strokes, redraw]);

    const pushUndo = () => {
      undoStackRef.current.push([...strokesRef.current]);
      if (undoStackRef.current.length > 50) undoStackRef.current.shift();
      redoStackRef.current = [];
      forceRender(v => v + 1);
    };

    const undo = useCallback(() => {
      if (undoStackRef.current.length === 0) return;
      redoStackRef.current.push([...strokesRef.current]);
      strokesRef.current = undoStackRef.current.pop()!;
      onStrokesChange(strokesRef.current);
      redraw();
      forceRender(v => v + 1);
    }, [onStrokesChange, redraw]);

    const redo = useCallback(() => {
      if (redoStackRef.current.length === 0) return;
      undoStackRef.current.push([...strokesRef.current]);
      strokesRef.current = redoStackRef.current.pop()!;
      onStrokesChange(strokesRef.current);
      redraw();
      forceRender(v => v + 1);
    }, [onStrokesChange, redraw]);

    const canUndo = useCallback(() => undoStackRef.current.length > 0, []);
    const canRedo = useCallback(() => redoStackRef.current.length > 0, []);

    const exportCanvas = useCallback(() => {
      return canvasRef.current;
    }, []);

    useImperativeHandle(ref, () => ({ undo, redo, canUndo, canRedo, exportCanvas }), [undo, redo, canUndo, canRedo, exportCanvas]);

    // ── Pointer Events ──────────────────────────────────────────

    const getNormalizedPoint = (e: PointerEvent): { x: number; y: number; p: number } => {
      const canvas = canvasRef.current!;
      const rect = canvas.getBoundingClientRect();
      const visualX = (e.clientX - rect.left) / rect.width;
      const visualY = (e.clientY - rect.top) / rect.height;
      const normalizedRotation = ((rotation % 360) + 360) % 360;
      let x = visualX;
      let y = visualY;
      if (normalizedRotation === 90) {
        x = visualY;
        y = 1 - visualX;
      } else if (normalizedRotation === 180) {
        x = 1 - visualX;
        y = 1 - visualY;
      } else if (normalizedRotation === 270) {
        x = 1 - visualY;
        y = visualX;
      }
      const p = e.pressure && e.pressure > 0 ? e.pressure : 0.5;
      return { x: Math.max(0, Math.min(1, x)), y: Math.max(0, Math.min(1, y)), p };
    };

    const onPointerDown = (e: React.PointerEvent) => {
      if (readOnly) return;
      // Apple Pencil: pointerType === 'pen'
      // Touch: pointerType === 'touch' → let browser handle scroll/zoom
      if (e.pointerType === 'touch') return;

      e.preventDefault();
      e.stopPropagation();
      canvasRef.current?.setPointerCapture(e.pointerId);

      if (tool === 'eraser') {
        // Hit test: find stroke near click point
        const pt = getNormalizedPoint(e.nativeEvent);
        const hit = findStrokeAt(strokesRef.current, pt, width, height);
        if (hit !== -1) {
          pushUndo();
          strokesRef.current = strokesRef.current.filter((_, i) => i !== hit);
          onStrokesChange(strokesRef.current);
          redraw();
        }
        return;
      }

      drawingRef.current = true;
      isPencilActiveRef.current = e.pointerType === 'pen';
      const pt = getNormalizedPoint(e.nativeEvent);
      currentStrokeRef.current = {
        tool,
        color,
        width: penWidth,
        points: [pt],
      };
      redraw();
    };

    const onPointerMove = (e: React.PointerEvent) => {
      if (!drawingRef.current || !currentStrokeRef.current) return;
      e.preventDefault();
      e.stopPropagation();
      const pt = getNormalizedPoint(e.nativeEvent);
      const pts = currentStrokeRef.current.points;
      const last = pts[pts.length - 1];
      // Skip tiny movements to reduce point count
      if (Math.abs(pt.x - last.x) < 0.002 && Math.abs(pt.y - last.y) < 0.002) return;
      pts.push(pt);
      redraw();
    };

    const onPointerUp = (e: React.PointerEvent) => {
      if (!drawingRef.current || !currentStrokeRef.current) return;
      e.preventDefault();
      e.stopPropagation();
      drawingRef.current = false;
      isPencilActiveRef.current = false;

      if (currentStrokeRef.current.points.length >= 2) {
        pushUndo();
        strokesRef.current = [...strokesRef.current, currentStrokeRef.current];
        onStrokesChange(strokesRef.current);
      }
      currentStrokeRef.current = null;
      redraw();
    };

    return (
      <canvas
        ref={canvasRef}
        className="assignment-mode-canvas absolute inset-0 touch-none"
        style={{
          width: '100%',
          height: '100%',
          userSelect: 'none',
          WebkitUserSelect: 'none',
          WebkitTouchCallout: 'none',
          touchAction: 'none',
        }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onContextMenu={(e) => e.preventDefault()}
        onDragStart={(e) => e.preventDefault()}
      />
    );
  }
);

DrawingCanvas.displayName = 'DrawingCanvas';
export default DrawingCanvas;

// ── Helpers ────────────────────────────────────────────────────

function drawStroke(ctx: CanvasRenderingContext2D, stroke: Stroke, w: number, h: number) {
  if (stroke.points.length < 2) {
    // Draw a dot
    const p = stroke.points[0];
    ctx.fillStyle = stroke.color;
    ctx.globalAlpha = stroke.tool === 'highlighter' ? 0.35 : 1;
    ctx.beginPath();
    ctx.arc(p.x * w, p.y * h, (stroke.width / 2), 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;
    return;
  }

  ctx.strokeStyle = stroke.color;
  ctx.lineWidth = stroke.width;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.globalAlpha = stroke.tool === 'highlighter' ? 0.35 : 1;

  ctx.beginPath();
  ctx.moveTo(stroke.points[0].x * w, stroke.points[0].y * h);

  for (let i = 1; i < stroke.points.length; i++) {
    const p = stroke.points[i];
    const prev = stroke.points[i - 1];
    // Pressure affects width
    if (p.p !== undefined && prev.p !== undefined) {
      const avgP = (p.p + prev.p) / 2;
      ctx.lineWidth = stroke.width * (0.5 + avgP * 0.8);
    }
    // Quadratic curve for smoothness
    const midX = (prev.x + p.x) / 2 * w;
    const midY = (prev.y + p.y) / 2 * h;
    ctx.quadraticCurveTo(prev.x * w, prev.y * h, midX, midY);
  }
  ctx.stroke();
  ctx.globalAlpha = 1;
}

function findStrokeAt(strokes: Stroke[], pt: { x: number; y: number }, w: number, h: number): number {
  const px = pt.x * w;
  const py = pt.y * h;
  const threshold = 12;

  for (let i = strokes.length - 1; i >= 0; i--) {
    const stroke = strokes[i];
    for (const p of stroke.points) {
      const sx = p.x * w;
      const sy = p.y * h;
      const dist = Math.sqrt((sx - px) ** 2 + (sy - py) ** 2);
      if (dist < threshold + stroke.width) return i;
    }
  }
  return -1;
}
