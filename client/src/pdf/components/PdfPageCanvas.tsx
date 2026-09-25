import { useCallback, useEffect, useRef, useState } from 'react';
import { renderPageToCanvas, isCancelError } from '../lib/pdfjs';
import { ANNOTATION_COLORS, getAnnotationColor } from '../../utils/annotationColors';
import type { PdfAnnotation } from '../api/pdfClient';

export type PdfToolMode = 'view' | 'note' | 'highlight';

interface Props {
  doc: any;
  /** 页面显示宽度（CSS px） */
  width: number;
  pageNumber: number;
  tool?: PdfToolMode;
  annotations?: PdfAnnotation[];
  showAnnotations?: boolean;
  colorIndex?: Map<number, number>;
  selectedAnnotationId?: number | null;
  onAnnotationClick?: (id: number | null) => void;
  onSaveAnnotation?: (data: { type: string; contentJson: Record<string, unknown> }) => void;
  onRendered?: (size: { w: number; h: number }) => void;
  onRatio?: (ratio: number) => void;
}

/**
 * PDF 模式的书页渲染 + 批注叠加层。
 *
 * 与图片版 PageCanvas 的分工一致：底层是页面（这里换成 pdf.js 渲染的矢量 canvas），
 * 上层是一个透明的批注 canvas，两者尺寸严格对齐。
 *
 * ⚠️ 上层 canvas 的位图尺寸就取 CSS 像素、不乘 devicePixelRatio —— 批注只是标记层，
 * 这样 lineWidth=2 才对应 2 个 CSS 像素，与图片版的视觉效果一致；
 * 若乘了 dpr，同样的 lineWidth 在屏幕上会细一半。
 */
export default function PdfPageCanvas({
  doc,
  width,
  pageNumber,
  tool = 'view',
  annotations = [],
  showAnnotations = true,
  colorIndex,
  selectedAnnotationId = null,
  onAnnotationClick,
  onSaveAnnotation,
  onRendered,
  onRatio,
}: Props) {
  const pageCanvasRef = useRef<HTMLCanvasElement>(null);
  const annCanvasRef = useRef<HTMLCanvasElement>(null);

  const [ratio, setRatio] = useState(0); // height / width，决定容器高度
  const [drawing, setDrawing] = useState(false);
  const [rect, setRect] = useState({ x: 0, y: 0, w: 0, h: 0 });
  // 框选起点：move 时用起点与当前点做归一化，保证任意方向拖拽都能得到正的宽高
  const startRef = useRef({ x: 0, y: 0 });
  const [noteInput, setNoteInput] = useState<{ x: number; y: number } | null>(null);
  const [noteText, setNoteText] = useState('');

  const cssHeight = ratio > 0 ? Math.round(width * ratio) : 0;

  // ── 页面渲染（cancelled 标志确保只有最后一次渲染结果生效） ──
  useEffect(() => {
    const canvas = pageCanvasRef.current;
    if (!doc || !canvas || width <= 0) return;

    let cancelled = false;
    (async () => {
      try {
        const size = await renderPageToCanvas(doc, pageNumber, canvas, width);
        if (cancelled) return;
        const nextRatio = size.height / size.width;
        setRatio(nextRatio);
        onRatio?.(nextRatio);
        onRendered?.({ w: width, h: Math.round(width * nextRatio) });
      } catch (e) {
        if (!isCancelError(e)) {
          console.error('[pdf] render page failed:', e);
        }
      }
    })();

    return () => { cancelled = true; };
  }, [doc, pageNumber, width, onRatio, onRendered]);

  // ── 批注层绘制 ────────────────────────────────────────────
  const renderAnnotations = useCallback(() => {
    const canvas = annCanvasRef.current;
    if (!canvas || width <= 0 || cssHeight <= 0) return;

    canvas.width = Math.round(width);
    canvas.height = cssHeight;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (!showAnnotations) return;

    const pageAnnotations = annotations.filter((a) => a.pageNumber === pageNumber);

    for (const ann of pageAnnotations) {
      const c = ann.contentJson as any;
      const ci = colorIndex?.get(ann.id) ?? 0;
      const color = getAnnotationColor(ci);
      const isSelected = selectedAnnotationId === ann.id;
      const isDimmed = selectedAnnotationId !== null && !isSelected;
      const alpha = isDimmed ? '30' : isSelected ? 'ff' : 'cc';

      if (ann.type === 'highlight') {
        ctx.fillStyle = color.hex + (isDimmed ? '15' : '40');
        ctx.fillRect(c.x * canvas.width, c.y * canvas.height, c.w * canvas.width, c.h * canvas.height);
        ctx.strokeStyle = color.hex + alpha;
        ctx.lineWidth = isSelected ? 3 : 1.5;
        ctx.setLineDash([4, 3]);
        ctx.strokeRect(c.x * canvas.width, c.y * canvas.height, c.w * canvas.width, c.h * canvas.height);
        ctx.setLineDash([]);
      } else if (ann.type === 'note') {
        const radius = isSelected ? 13 : 10;
        ctx.fillStyle = color.hex + alpha;
        ctx.beginPath();
        ctx.arc(c.x * canvas.width, c.y * canvas.height, radius, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = '#fff';
        ctx.lineWidth = 2;
        ctx.stroke();
        if (isSelected) {
          ctx.beginPath();
          ctx.arc(c.x * canvas.width, c.y * canvas.height, radius + 4, 0, Math.PI * 2);
          ctx.strokeStyle = color.hex;
          ctx.lineWidth = 3;
          ctx.stroke();
        }
        ctx.fillStyle = '#fff';
        ctx.font = 'bold 11px sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(String(ci + 1), c.x * canvas.width, c.y * canvas.height);
      } else if (ann.type === 'crop') {
        ctx.setLineDash([6, 4]);
        ctx.strokeStyle = color.hex + alpha;
        ctx.lineWidth = isSelected ? 3 : 2;
        ctx.strokeRect(c.x * canvas.width, c.y * canvas.height, c.w * canvas.width, c.h * canvas.height);
        ctx.setLineDash([]);
      }
    }

    if (drawing && rect.w > 0 && rect.h > 0) {
      ctx.fillStyle = 'rgba(37, 99, 235, 0.1)';
      ctx.strokeStyle = '#2563eb';
      ctx.lineWidth = 2;
      ctx.fillRect(rect.x, rect.y, rect.w, rect.h);
      ctx.strokeRect(rect.x, rect.y, rect.w, rect.h);
    }
  }, [annotations, pageNumber, width, cssHeight, ratio, showAnnotations, colorIndex, selectedAnnotationId, drawing, rect]);

  useEffect(() => { renderAnnotations(); }, [renderAnnotations]);

  // 窗口尺寸变化时重绘批注层（canvas 位图不随 CSS 缩放自动重排）
  useEffect(() => {
    const handler = () => renderAnnotations();
    window.addEventListener('resize', handler);
    return () => window.removeEventListener('resize', handler);
  }, [renderAnnotations]);

  // ── 交互 ──────────────────────────────────────────────────
  const getPos = (e: React.MouseEvent) => {
    const canvas = annCanvasRef.current!;
    const r = canvas.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };

  const hitTest = (pos: { x: number; y: number }): number | null => {
    const canvas = annCanvasRef.current!;
    const pageAnnotations = annotations.filter((a) => a.pageNumber === pageNumber);
    // 与图片版一致：按创建顺序从头找，先创建的优先命中
    for (let i = 0; i < pageAnnotations.length; i++) {
      const c = pageAnnotations[i].contentJson as any;
      if (pageAnnotations[i].type === 'note') {
        const dx = pos.x - c.x * canvas.width;
        const dy = pos.y - c.y * canvas.height;
        if (Math.sqrt(dx * dx + dy * dy) <= 14) return pageAnnotations[i].id;
      } else {
        const ax = c.x * canvas.width;
        const ay = c.y * canvas.height;
        const aw = c.w * canvas.width;
        const ah = c.h * canvas.height;
        if (pos.x >= ax && pos.x <= ax + aw && pos.y >= ay && pos.y <= ay + ah) return pageAnnotations[i].id;
      }
    }
    return null;
  };

  const handleMouseDown = (e: React.MouseEvent) => {
    if (tool === 'note') {
      const pos = getPos(e);
      setNoteInput(pos);
      setNoteText('');
      return;
    }
    if (tool === 'highlight') {
      const pos = getPos(e);
      setDrawing(true);
      startRef.current = pos;
      setRect({ x: pos.x, y: pos.y, w: 0, h: 0 });
      return;
    }
    if (tool === 'view' && onAnnotationClick) {
      const pos = getPos(e);
      const hit = showAnnotations ? hitTest(pos) : null;
      onAnnotationClick(hit);
    }
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (!drawing) return;
    const pos = getPos(e);
    const s = startRef.current;
    // Math.min / Math.abs 归一化：从右下往左上拖也能得到正常的选区
    setRect({
      x: Math.min(s.x, pos.x),
      y: Math.min(s.y, pos.y),
      w: Math.abs(pos.x - s.x),
      h: Math.abs(pos.y - s.y),
    });
  };

  const handleMouseUp = () => {
    if (!drawing) return;
    const canvas = annCanvasRef.current!;
    if (rect.w < 5 || rect.h < 5) {
      // 小于 5px 视为误触
      setDrawing(false);
      setRect({ x: 0, y: 0, w: 0, h: 0 });
      return;
    }
    onSaveAnnotation?.({
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
    if (noteText.trim() && noteInput && annCanvasRef.current) {
      const canvas = annCanvasRef.current;
      onSaveAnnotation?.({
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
    <div className="relative inline-block" style={{ width: `${width}px` }}>
      <canvas ref={pageCanvasRef} className="block w-full select-none" />

      <canvas
        ref={annCanvasRef}
        className={`absolute top-0 left-0 w-full h-full ${
          tool === 'view' ? 'cursor-pointer' : tool === 'note' ? 'cursor-text' : 'cursor-crosshair'
        }`}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
      />

      {noteInput && (
        <div
          className="absolute z-30 w-48 rounded-lg border border-border bg-card p-2 shadow-xl"
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
            placeholder="输入批注内容，回车保存"
            className="w-full resize-none rounded border border-border bg-transparent px-1.5 py-1 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary"
            rows={3}
          />
          <div className="mt-1 flex justify-end gap-1">
            <button
              onClick={() => { setNoteInput(null); setNoteText(''); }}
              className="rounded px-2 py-0.5 text-xs text-muted-foreground hover:bg-muted"
            >
              取消
            </button>
            <button
              onClick={submitNote}
              className="rounded bg-primary px-2 py-0.5 text-xs text-white"
            >
              保存
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
