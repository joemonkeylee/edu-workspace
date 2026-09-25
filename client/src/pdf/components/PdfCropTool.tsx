import { useEffect, useRef, useState } from 'react';
import { Scissors, Check, X } from 'lucide-react';
import { renderPageOffscreen } from '../lib/pdfjs';
import PdfPageCanvas from './PdfPageCanvas';

const SUBJECTS = ['语文', '数学', '英语', '物理', '化学', '生物', '政治', '历史', '地理', '科学', '道法'];

interface CropRect { x: number; y: number; w: number; h: number }

interface Props {
  doc: any;
  pageNumber: number;
  /** 页面显示宽度（CSS px） */
  width: number;
  onSave: (blob: Blob, cropData: { x: number; y: number; w: number; h: number }, subject: string, tags: string) => Promise<void>;
  onCancel: () => void;
}

/**
 * PDF 模式的错题裁剪。
 *
 * 图片版用 react-image-crop 包着 <img> 取 naturalWidth 来裁；这里的底图是 canvas，
 * ReactCrop 拿不到自然尺寸，所以直接在画布上自己画选区 —— 少一个依赖，也更可控。
 *
 * 保存时不裁屏幕上的那张（只有一千来像素宽，放大就糊），而是用 pdf.js
 * 离屏按更高分辨率重新渲染整页，再按归一化坐标取样 —— PDF 是矢量，放大不失真。
 */
export default function PdfCropTool({ doc, pageNumber, width, onSave, onCancel }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const startRef = useRef<{ x: number; y: number } | null>(null);
  const [sel, setSel] = useState<CropRect | null>(null);
  const [drawing, setDrawing] = useState(false);

  const [showForm, setShowForm] = useState(false);
  const [subject, setSubject] = useState('');
  const [tags, setTags] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setSel(null);
    setShowForm(false);
  }, [pageNumber]);

  const getPos = (e: React.MouseEvent) => {
    const el = containerRef.current!;
    const r = el.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };

  const handleMouseDown = (e: React.MouseEvent) => {
    if (showForm) return;
    e.preventDefault();
    const p = getPos(e);
    startRef.current = p;
    setDrawing(true);
    setSel({ x: p.x, y: p.y, w: 0, h: 0 });
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (!drawing || !startRef.current) return;
    const p = getPos(e);
    // 允许从任意方向拖：统一归一化为正的宽高
    setSel({
      x: Math.min(p.x, startRef.current.x),
      y: Math.min(p.y, startRef.current.y),
      w: Math.abs(p.x - startRef.current.x),
      h: Math.abs(p.y - startRef.current.y),
    });
  };

  const handleMouseUp = () => {
    if (!drawing) return;
    setDrawing(false);
    startRef.current = null;
    setSel((s) => (s && (s.w < 5 || s.h < 5) ? null : s));
  };

  const generateBlob = async (): Promise<{ blob: Blob; cropData: CropRect } | null> => {
    if (!sel || !containerRef.current) return null;
    const displayW = containerRef.current.clientWidth;
    const displayH = containerRef.current.clientHeight;
    if (!displayW || !displayH) return null;

    // 归一化坐标（相对显示尺寸）
    const nx = sel.x / displayW;
    const ny = sel.y / displayH;
    const nw = sel.w / displayW;
    const nh = sel.h / displayH;

    // 离屏按更高分辨率重渲染整页
    const renderWidth = Math.min(4096, Math.max(displayW, 1400) * 2);
    const pageCanvas = await renderPageOffscreen(doc, pageNumber, renderWidth);

    const sx = Math.round(nx * pageCanvas.width);
    const sy = Math.round(ny * pageCanvas.height);
    const sw = Math.max(1, Math.round(nw * pageCanvas.width));
    const sh = Math.max(1, Math.round(nh * pageCanvas.height));

    const out = document.createElement('canvas');
    out.width = sw;
    out.height = sh;
    const ctx = out.getContext('2d');
    if (!ctx) return null;
    ctx.drawImage(pageCanvas, sx, sy, sw, sh, 0, 0, sw, sh);

    const blob = await new Promise<Blob | null>((resolve) => out.toBlob(resolve, 'image/png'));
    if (!blob) return null;

    return { blob, cropData: { x: nx, y: ny, w: nw, h: nh } };
  };

  const handleConfirm = async () => {
    const result = await generateBlob();
    if (!result) return;
    setSaving(true);
    try {
      await onSave(result.blob, result.cropData, subject || '未分类', tags);
      setSel(null);
      setShowForm(false);
      setSubject('');
      setTags('');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="relative inline-block" ref={containerRef}>
      <PdfPageCanvas doc={doc} pageNumber={pageNumber} width={width} />

      {/* 选区绘制层 */}
      <div
        className="absolute inset-0"
        style={{ cursor: 'crosshair' }}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
      >
        {sel && sel.w > 0 && sel.h > 0 && (
          <div
            className="absolute border-2 border-blue-500 bg-blue-500/10"
            style={{ left: sel.x, top: sel.y, width: sel.w, height: sel.h }}
          />
        )}
      </div>

      {sel && sel.w > 5 && sel.h > 5 && (
        <div className="absolute right-2 top-2 z-30 flex flex-col items-end gap-2">
          {!showForm ? (
            <button
              onClick={() => setShowForm(true)}
              className="flex items-center gap-1 rounded-lg bg-primary px-3 py-1.5 text-xs text-white shadow-lg hover:bg-primary/90"
            >
              <Scissors size={14} /> 保存错题
            </button>
          ) : (
            <div className="w-56 rounded-lg border border-border bg-card p-3 shadow-xl">
              <div className="mb-2">
                <label className="mb-1 block text-[11px] text-muted-foreground">学科</label>
                <input
                  list="pdf-crop-subjects"
                  value={subject}
                  onChange={(e) => setSubject(e.target.value)}
                  placeholder="未分类"
                  className="w-full rounded border border-border bg-transparent px-2 py-1 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                />
                <datalist id="pdf-crop-subjects">
                  {SUBJECTS.map((s) => (<option key={s} value={s} />))}
                </datalist>
              </div>
              <div className="mb-3">
                <label className="mb-1 block text-[11px] text-muted-foreground">标签（逗号分隔）</label>
                <input
                  value={tags}
                  onChange={(e) => setTags(e.target.value)}
                  placeholder="如：易错题，期中"
                  className="w-full rounded border border-border bg-transparent px-2 py-1 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                />
              </div>
              <div className="flex justify-end gap-2">
                <button
                  onClick={() => { setShowForm(false); }}
                  className="flex items-center gap-1 rounded px-2 py-1 text-xs text-muted-foreground hover:bg-muted"
                >
                  <X size={14} /> 取消
                </button>
                <button
                  onClick={handleConfirm}
                  disabled={saving}
                  className="flex items-center gap-1 rounded bg-primary px-2 py-1 text-xs text-white disabled:opacity-50"
                >
                  <Check size={14} /> {saving ? '保存中...' : '确认保存'}
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      <button
        onClick={onCancel}
        className="absolute left-2 top-2 z-30 flex items-center gap-1 rounded-lg bg-card/90 px-2 py-1 text-xs text-muted-foreground shadow hover:text-foreground"
      >
        <X size={14} /> 退出裁剪
      </button>
    </div>
  );
}
