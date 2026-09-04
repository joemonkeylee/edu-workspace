import { useRef, useEffect, useState, useCallback } from 'react';
import type { Annotation, ToolMode } from '../types';
import { pageImageUrl } from '../api/client';

interface PageCanvasProps {
  storagePath: string;
  pageNumber: number;
  zoom: number;
  tool: ToolMode;
  annotations: Annotation[];
  onSaveAnnotation: (data: { type: string; contentJson: any }) => void;
}

export default function PageCanvas({
  storagePath,
  pageNumber,
  zoom,
  tool,
  annotations,
  onSaveAnnotation,
}: PageCanvasProps) {
  const imgRef = useRef<HTMLImageElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [drawing, setDrawing] = useState(false);
  const [start, setStart] = useState({ x: 0, y: 0 });
  const [rect, setRect] = useState({ x: 0, y: 0, w: 0, h: 0 });
  const [noteInput, setNoteInput] = useState<{ x: number; y: number } | null>(null);
  const [noteText, setNoteText] = useState('');
  const [naturalSize, setNaturalSize] = useState({ w: 0, h: 0 });

  const src = pageImageUrl(storagePath, pageNumber);

  const render = useCallback(() => {
    const canvas = canvasRef.current;
    const img = imgRef.current;
    if (!canvas || !img || !img.complete || img.clientWidth === 0) return;

    canvas.width = img.clientWidth;
    canvas.height = img.clientHeight;
    const ctx = canvas.getContext('2d')!;
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    for (const ann of annotations) {
      if (ann.pageNumber !== pageNumber) continue;
      const c = ann.contentJson;
      if (ann.type === 'highlight') {
        ctx.fillStyle = c.color || 'rgba(255, 235, 59, 0.3)';
        ctx.fillRect(c.x * canvas.width, c.y * canvas.height, c.w * canvas.width, c.h * canvas.height);
      } else if (ann.type === 'note') {
        ctx.fillStyle = '#f59e0b';
        ctx.beginPath();
        ctx.arc(c.x * canvas.width, c.y * canvas.height, 10, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = '#fff';
        ctx.lineWidth = 2;
        ctx.stroke();
      } else if (ann.type === 'crop') {
        ctx.strokeStyle = '#3b82f6';
        ctx.setLineDash([6, 4]);
        ctx.lineWidth = 2;
        ctx.strokeRect(c.x * canvas.width, c.y * canvas.height, c.w * canvas.width, c.h * canvas.height);
        ctx.setLineDash([]);
      }
    }

    if (drawing && rect.w > 0 && rect.h > 0) {
      ctx.strokeStyle = '#2563eb';
      ctx.lineWidth = 2;
      ctx.strokeRect(rect.x, rect.y, rect.w, rect.h);
      ctx.fillStyle = 'rgba(37, 99, 235, 0.1)';
      ctx.fillRect(rect.x, rect.y, rect.w, rect.h);
    }
  }, [annotations, pageNumber, drawing, rect]);

  useEffect(() => {
    render();
  }, [render]);

  useEffect(() => {
    const img = imgRef.current;
    if (!img) return;
    const handler = () => render();
    img.addEventListener('load', handler);
    window.addEventListener('resize', handler);
    return () => {
      img.removeEventListener('load', handler);
      window.removeEventListener('resize', handler);
    };
  }, [render]);

  const getPos = (e: React.MouseEvent) => {
    const canvas = canvasRef.current!;
    const r = canvas.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };

  const handleMouseDown = (e: React.MouseEvent) => {
    if (tool === 'view') return;
    const pos = getPos(e);
    if (tool === 'note') {
      setNoteInput(pos);
      setNoteText('');
    } else if (tool === 'highlight') {
      setDrawing(true);
      setStart(pos);
    }
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (!drawing) return;
    const pos = getPos(e);
    setRect({
      x: Math.min(start.x, pos.x),
      y: Math.min(start.y, pos.y),
      w: Math.abs(pos.x - start.x),
      h: Math.abs(pos.y - start.y),
    });
  };

  const handleMouseUp = () => {
    if (!drawing || rect.w < 5 || rect.h < 5) {
      setDrawing(false);
      setRect({ x: 0, y: 0, w: 0, h: 0 });
      return;
    }
    const canvas = canvasRef.current!;
    onSaveAnnotation({
      type: 'highlight',
      contentJson: {
        x: rect.x / canvas.width,
        y: rect.y / canvas.height,
        w: rect.w / canvas.width,
        h: rect.h / canvas.height,
        color: 'rgba(255, 235, 59, 0.3)',
      },
    });
    setDrawing(false);
    setRect({ x: 0, y: 0, w: 0, h: 0 });
  };

  const submitNote = () => {
    if (noteText.trim() && noteInput && canvasRef.current) {
      const canvas = canvasRef.current;
      onSaveAnnotation({
        type: 'note',
        contentJson: {
          x: noteInput.x / canvas.width,
          y: noteInput.y / canvas.height,
          text: noteText.trim(),
        },
      });
    }
    setNoteInput(null);
    setNoteText('');
  };

  return (
    <div
      className="relative inline-block"
      style={naturalSize.w > 0 ? { width: `${naturalSize.w * zoom}px` } : undefined}
    >
      <img
        ref={imgRef}
        src={src}
        alt={`Page ${pageNumber}`}
        className="w-full block select-none"
        draggable={false}
        loading="lazy"
        decoding="async"
        onLoad={(e) => {
          const img = e.currentTarget;
          setNaturalSize({ w: img.naturalWidth, h: img.naturalHeight });
        }}
      />
      <canvas
        ref={canvasRef}
        className="absolute top-0 left-0 w-full h-full"
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
        style={{ cursor: tool === 'view' ? 'default' : 'crosshair' }}
      />
      {noteInput && (
        <div
          className="absolute z-10 bg-white rounded-lg shadow-lg border border-gray-200 p-2"
          style={{ left: noteInput.x, top: noteInput.y + 15 }}
        >
          <textarea
            autoFocus
            value={noteText}
            onChange={(e) => setNoteText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                submitNote();
              }
              if (e.key === 'Escape') {
                setNoteInput(null);
                setNoteText('');
              }
            }}
            placeholder="输入笔记..."
            className="w-48 h-16 text-sm border border-gray-300 rounded px-2 py-1 resize-none focus:outline-none focus:ring-2 focus:ring-primary"
          />
          <div className="flex justify-end gap-1 mt-1">
            <button
              onClick={() => {
                setNoteInput(null);
                setNoteText('');
              }}
              className="text-xs text-gray-500 px-2 py-1 hover:text-gray-700"
            >
              取消
            </button>
            <button
              onClick={submitNote}
              className="text-xs bg-primary text-white px-2 py-1 rounded hover:bg-primaryDark"
            >
              保存
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
