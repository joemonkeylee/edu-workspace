import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import {
  ArrowLeft, MousePointer2, StickyNote, Highlighter, Scissors, ZoomIn, ZoomOut,
  Maximize2, Minimize2, Book, BookOpen, PanelLeft, PanelRight, ChevronFirst, ChevronLast,
  ChevronLeft, ChevronRight, Trash2, CheckCircle2, Circle, RotateCw, RotateCcw, Layers,
  Download, PenLine, MoreVertical, X, Star, FileText, AlertTriangle,
} from 'lucide-react';
import { toast } from 'sonner';
import { getAccessToken } from '../../api/client';
import { useAuthStore } from '../../store/authStore';
import { buildAnnotationColorIndex, getAnnotationColor } from '../../utils/annotationColors';
import { useConfirm } from '../../components/ConfirmDialog';
import PdfPageCanvas from '../components/PdfPageCanvas';
import PdfCropTool from '../components/PdfCropTool';
import PdfTocTree, { type PdfTocView } from '../components/PdfTocTree';
import PdfAssignmentList from '../components/PdfAssignmentList';
import PdfAssignmentMode from '../components/PdfAssignmentMode';
import {
  getBook, listAnnotations, createAnnotation, deleteAnnotation, updateMistake,
  toggleFavorite, getReadingProgress, saveReadingProgress,
  createAssignment, getAssignment, listAssignments,
  pdfFileUrl, type PdfAnnotation, type PdfBookDetail, type PdfAssignment,
} from '../api/pdfClient';
import { getCachedDocument, getPageSize } from '../lib/pdfjs';
import { APP_NAME, withEnvPrefix } from '../../lib/appEnv';

type FitMode = 'width' | 'page' | null;
type PageLayout = 'single' | 'double';
type PdfToolMode = 'view' | 'note' | 'highlight' | 'crop';

const LEFT_MIN = 240;
const LEFT_SNAP_TOLERANCE = 16;
/** PDF 点 → CSS 像素（96dpi 基准），用于把 zoom 换算成显示宽度 */
const PT_TO_PX = 96 / 72;
const ZOOM_LEVELS = [0.25, 0.33, 0.5, 0.67, 0.75, 0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2, 2.5, 3, 4, 5];

const SEARCHABLE_LABEL: Record<string, string> = {
  ok: '可搜索',
  no_text: '扫描件·不可搜',
  garbled: '编码损坏',
  watermark_only: '仅水印',
};

const STORAGE_KEY = 'edu-pdf-read-config';

function loadReadConfigLocal(bookId: number) {
  try {
    const all = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
    const cfg = all[String(bookId)] || {};
    return {
      page: cfg.page || 1,
      pageLayout: (cfg.pageLayout || 'single') as PageLayout,
      fitMode: (cfg.fitMode || 'page') as FitMode,
      rotation: cfg.rotation || 0,
      zoom: cfg.zoom || 1,
    };
  } catch {
    return { page: 1, pageLayout: 'single' as PageLayout, fitMode: 'page' as FitMode, rotation: 0, zoom: 1 };
  }
}

function saveReadConfigLocal(bookId: number, data: Record<string, unknown>) {
  try {
    const all = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
    all[String(bookId)] = { ...all[String(bookId)], ...data };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(all));
  } catch { /* ignore */ }
}

/** 错题图走 /api/pdf/mistakes/:id/image，<img> 无法带 header，token 拼在 query 上 */
function withToken(url: string): string {
  const token = getAccessToken();
  if (!token) return url;
  const sep = url.includes('?') ? '&' : '?';
  return `${url}${sep}token=${encodeURIComponent(token)}`;
}

export default function PdfBookViewer() {
  const { id } = useParams();
  const bookId = Number(id);
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const confirm = useConfirm();
  const { user, authEnabled } = useAuthStore();

  const assignmentId = Number(searchParams.get('assignmentId'));
  const gradingEntry = searchParams.get('grading') === '1';
  const role = searchParams.get('role') || '';
  const isTeacher = role === 'teacher' || gradingEntry;
  // roles 才是权威来源：user.role 只是 roles[0]，多角色（如 student+teacher）时会漏判
  const canGrade = isTeacher && (!authEnabled || Boolean(user?.isAdmin || user?.roles?.includes('teacher') || user?.role === 'teacher'));

  const [book, setBook] = useState<PdfBookDetail | null>(null);
  const [doc, setDoc] = useState<any>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [annotations, setAnnotations] = useState<PdfAnnotation[]>([]);
  const [isFavorite, setIsFavorite] = useState(false);

  const [page, setPage] = useState(1);
  const [zoom, setZoom] = useState(1);
  const [fitMode, setFitMode] = useState<FitMode>('page');
  const [pageLayout, setPageLayout] = useState<PageLayout>('single');
  const [rotation, setRotation] = useState(0);
  const [tool, setTool] = useState<PdfToolMode>('view');
  const [pageBase, setPageBase] = useState({ w: 794, h: 1123 }); // A4 @96dpi 默认
  const [savedConfig, setSavedConfig] = useState<ReturnType<typeof loadReadConfigLocal> | null>(null);

  const [leftOpen, setLeftOpen] = useState(true);
  const [leftView, setLeftView] = useState<PdfTocView>('thumbs');
  const [leftWidth, setLeftWidth] = useState(LEFT_MIN);
  const [rightOpen, setRightOpen] = useState(true);
  const [rightTab, setRightTab] = useState<'annotations' | 'assignments'>('assignments');
  const [showAnnotations, setShowAnnotations] = useState(true);
  const [layers, setLayers] = useState({ annotations: true, highlights: true, assignments: true, grading: true });
  const [layerDropdownOpen, setLayerDropdownOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const [selectedAnnotationId, setSelectedAnnotationId] = useState<number | null>(null);
  // 点批注跳转页面时不清除选中态（与图片版一致）
  const skipClearRef = useRef(false);
  const [deleteAnnId, setDeleteAnnId] = useState<number | null>(null);

  const [assignmentMode, setAssignmentMode] = useState(false);
  const [currentAssignment, setCurrentAssignment] = useState<PdfAssignment | null>(null);
  const [allAssignments, setAllAssignments] = useState<PdfAssignment[]>([]);
  const [assignmentCount, setAssignmentCount] = useState(0);
  const [assignmentRefresh, setAssignmentRefresh] = useState(0);
  const [enteringAssignment, setEnteringAssignment] = useState(false);
  const [assignmentPrompt, setAssignmentPrompt] = useState<PdfAssignment | null>(null);
  const creatingRef = useRef(false);

  const mainRef = useRef<HTMLDivElement>(null);
  const leftWidthRef = useRef(leftWidth);
  const draggingRef = useRef(false);
  const startXRef = useRef(0);
  const startWRef = useRef(0);
  const snapPointsRef = useRef<number[]>([]);
  const initWidthSet = useRef(false);
  const pageFitWidthRef = useRef(LEFT_MIN);

  const totalPages = book?.totalPages || 1;
  const effectiveRotation = ((rotation % 360) + 360) % 360;
  // 与图片版一致：非「浏览」工具（批注/高亮/裁剪/做题）强制单页，避免双页下批注坐标系错乱
  const effectiveLayout = tool !== 'view' ? 'single' as PageLayout : pageLayout;
  const isDouble = effectiveLayout === 'double' && page < totalPages;
  const step = isDouble ? 2 : 1;

  // ── 载入书籍与 PDF 文档 ────────────────────────────────────
  useEffect(() => {
    if (!bookId) return;
    let cancelled = false;
    setLoadError(null);

    (async () => {
      try {
        const cfg = await (async () => {
          const local = loadReadConfigLocal(bookId);
          if (authEnabled && user) {
            try {
              const p = await getReadingProgress(bookId);
              if (p) {
                return {
                  page: p.pageNumber || local.page,
                  pageLayout: (p.pageLayout || local.pageLayout) as PageLayout,
                  fitMode: (p.fitMode || local.fitMode) as FitMode,
                  rotation: p.rotation ?? local.rotation,
                  zoom: local.zoom,
                };
              }
            } catch { /* 回退本地 */ }
          }
          return local;
        })();
        if (cancelled) return;

        setSavedConfig(cfg);
        setFitMode(cfg.fitMode);
        setPageLayout(cfg.pageLayout);
        setRotation(cfg.rotation);
        setZoom(cfg.zoom);

        const [detail, anns] = await Promise.all([
          getBook(bookId),
          listAnnotations(bookId).catch(() => [] as PdfAnnotation[]),
        ]);
        if (cancelled) return;
        setBook(detail);
        setAnnotations(anns);
        setIsFavorite(Boolean((detail as any).isFavorite));
        setPage(cfg.page > 1 ? Math.min(cfg.page, detail.totalPages || 1) : 1);

        const d = await getCachedDocument(pdfFileUrl(bookId));
        if (cancelled) return;
        setDoc(d);
      } catch (e: any) {
        if (!cancelled) setLoadError(String(e?.message || e).slice(0, 200));
      }
    })();

    return () => { cancelled = true; };
  }, [bookId, authEnabled, user]);

  // 当前页的基础尺寸（pt），用于把 zoom 换算成显示宽度
  useEffect(() => {
    if (!doc) return;
    let cancelled = false;
    (async () => {
      try {
        const size = await getPageSize(doc, page);
        if (!cancelled) setPageBase({ w: size.w * PT_TO_PX, h: size.h * PT_TO_PX });
      } catch { /* ignore */ }
    })();
    return () => { cancelled = true; };
  }, [doc, page]);

  // ── 阅读配置持久化 ────────────────────────────────────────
  useEffect(() => {
    if (!bookId || !savedConfig) return;
    saveReadConfigLocal(bookId, { pageLayout, fitMode, rotation, zoom });
    if (authEnabled && user) {
      // fitMode 为 null 表示自定义缩放，此时不下发，避免覆盖云端的上次布局
      saveReadingProgress(bookId, { pageLayout, fitMode: fitMode ?? undefined, rotation, scale: zoom }).catch(() => {});
    }
  }, [bookId, savedConfig, pageLayout, fitMode, rotation, zoom, authEnabled, user]);

  const savePageTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (!bookId || !book) return;
    if (savePageTimer.current) clearTimeout(savePageTimer.current);
    savePageTimer.current = setTimeout(() => {
      saveReadConfigLocal(bookId, { page });
      if (authEnabled && user) {
        saveReadingProgress(bookId, { pageNumber: page }).catch(() => {});
      }
    }, 500);
    return () => { if (savePageTimer.current) clearTimeout(savePageTimer.current); };
  }, [bookId, page, book, authEnabled, user]);

  useEffect(() => {
    if (!book) return;
    document.title = withEnvPrefix([book.grade, book.subject, book.title].filter(Boolean).join(' ') || APP_NAME);
  }, [book]);

  // ── 左侧栏拖拽 ────────────────────────────────────────────
  const onResizeMove = useCallback((e: MouseEvent) => {
    if (!draggingRef.current) return;
    const delta = e.clientX - startXRef.current;
    let w = Math.max(LEFT_MIN, startWRef.current + delta);
    let bestDist = LEFT_SNAP_TOLERANCE;
    for (const sp of snapPointsRef.current) {
      const d = Math.abs(w - sp);
      if (d < bestDist) { bestDist = d; w = sp; }
    }
    leftWidthRef.current = w;
    setLeftWidth(w);
  }, []);

  const onResizeEnd = useCallback(() => {
    if (!draggingRef.current) return;
    draggingRef.current = false;
    document.body.style.cursor = '';
    document.body.style.userSelect = '';
    window.removeEventListener('mousemove', onResizeMove);
    window.removeEventListener('mouseup', onResizeEnd);
  }, [onResizeMove]);

  const startResize = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    const aside = e.currentTarget.parentElement as HTMLElement;
    startXRef.current = e.clientX;
    startWRef.current = aside.getBoundingClientRect().width;
    const fit = pageFitWidthRef.current;
    snapPointsRef.current = [fit, fit * 1.25, fit * 1.5].filter((p) => p >= LEFT_MIN);
    draggingRef.current = true;
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    window.addEventListener('mousemove', onResizeMove);
    window.addEventListener('mouseup', onResizeEnd);
  }, [onResizeMove, onResizeEnd]);

  // 左侧栏默认窄：固定 LEFT_MIN（w-60 = 240px），与图片版「无视频书」一致。
  // PDF 模块左侧没有视频 tab，不应像视频书那样把侧栏撑到「整页宽度」。
  // 标记 initWidthSet 已初始化，阻止下方 calcDisplayWidth 的首屏逻辑把它覆盖成 pageFitWidth。
  useEffect(() => {
    initWidthSet.current = true;
    leftWidthRef.current = LEFT_MIN;
    setLeftWidth(LEFT_MIN);
  }, [bookId]);

  // ── 缩放 ──────────────────────────────────────────────────
  const calcDisplayWidth = useCallback(() => {
    const el = mainRef.current;
    if (!el) return;
    const cw = el.clientWidth - 32;
    const ch = el.clientHeight - 32;
    const isRot = effectiveRotation === 90 || effectiveRotation === 270;
    const natW = isRot ? pageBase.h : pageBase.w;
    const natH = isRot ? pageBase.w : pageBase.h;
    const pages = isDouble ? 2 : 1;
    const gap = (pages - 1) * 4;
    const availPerPage = (cw - gap) / pages;
    const widthZoom = availPerPage / natW;
    const heightZoom = ch / natH;

    pageFitWidthRef.current = natW * Math.min(widthZoom, heightZoom);
    if (!draggingRef.current && !initWidthSet.current) {
      initWidthSet.current = true;
      const w = Math.max(LEFT_MIN, pageFitWidthRef.current);
      leftWidthRef.current = w;
      setLeftWidth(w);
    }

    if (fitMode) setZoom(fitMode === 'width' ? widthZoom : Math.min(widthZoom, heightZoom));
  }, [fitMode, pageBase, isDouble, effectiveRotation]);

  useEffect(() => { calcDisplayWidth(); }, [calcDisplayWidth]);

  useEffect(() => {
    const el = mainRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => calcDisplayWidth());
    ro.observe(el);
    return () => ro.disconnect();
  }, [calcDisplayWidth]);

  const snapZoom = (v: number) => {
    const clamped = Math.max(ZOOM_LEVELS[0], Math.min(ZOOM_LEVELS[ZOOM_LEVELS.length - 1], v));
    let nearest = ZOOM_LEVELS[0];
    let minDiff = Math.abs(clamped - nearest);
    for (const lvl of ZOOM_LEVELS) {
      const d = Math.abs(clamped - lvl);
      if (d < minDiff) { minDiff = d; nearest = lvl; }
    }
    return nearest;
  };

  const zoomIn = () => { setFitMode(null); setZoom((z) => { const s = snapZoom(z); return ZOOM_LEVELS.find((l) => l > s + 0.001) || ZOOM_LEVELS[ZOOM_LEVELS.length - 1]; }); };
  const zoomOut = () => { setFitMode(null); setZoom((z) => { const s = snapZoom(z); return [...ZOOM_LEVELS].reverse().find((l) => l < s - 0.001) || ZOOM_LEVELS[0]; }); };

  // 与图片版一致：点击百分比可手动输入精确缩放（回车提交 / Esc 取消）
  const [editingZoom, setEditingZoom] = useState(false);
  const [zoomInput, setZoomInput] = useState('');
  const startEditZoom = () => {
    setZoomInput(String(Math.round(snapZoom(zoom) * 100)));
    setEditingZoom(true);
  };
  const commitZoom = () => {
    setEditingZoom(false);
    const n = parseInt(zoomInput, 10);
    if (!Number.isFinite(n) || n <= 0) return;
    setFitMode(null);
    setZoom(Math.max(ZOOM_LEVELS[0], Math.min(ZOOM_LEVELS[ZOOM_LEVELS.length - 1], n / 100)));
  };

  const displayWidth = useMemo(() => {
    const isRot = effectiveRotation === 90 || effectiveRotation === 270;
    return Math.round((isRot ? pageBase.h : pageBase.w) * zoom);
  }, [pageBase, zoom, effectiveRotation]);

  // ── 翻页交互 ──────────────────────────────────────────────
  const goPage = useCallback((p: number) => {
    setPage(Math.max(1, Math.min(totalPages, p)));
  }, [totalPages]);

  // 普通翻页清除选中批注；点批注跳转已置 skipClearRef，不清
  useEffect(() => {
    if (skipClearRef.current) { skipClearRef.current = false; return; }
    setSelectedAnnotationId(null);
  }, [page]);

  useEffect(() => {
    if (!book || assignmentMode) return;
    const el = mainRef.current;
    if (!el) return;
    const handler = (e: WheelEvent) => {
      if (e.ctrlKey || e.metaKey) return;
      const atTop = el.scrollTop <= 0;
      const atBottom = el.scrollTop + el.clientHeight >= el.scrollHeight - 2;
      if (e.deltaY < 0 && atTop && page > 1) { e.preventDefault(); goPage(page - step); }
      else if (e.deltaY > 0 && atBottom && page < totalPages) { e.preventDefault(); goPage(page + step); }
    };
    el.addEventListener('wheel', handler, { passive: false });
    return () => el.removeEventListener('wheel', handler);
  }, [page, book, goPage, step, totalPages, assignmentMode]);

  useEffect(() => {
    if (!book || assignmentMode) return;
    const handler = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t instanceof HTMLInputElement || t instanceof HTMLTextAreaElement || t instanceof HTMLSelectElement) return;
      if (e.key === 'ArrowLeft' && page > 1) goPage(page - step);
      if (e.key === 'ArrowRight' && page < totalPages) goPage(page + step);
      if ((e.key === 'PageUp' || e.key === ' ') && page > 1) { e.preventDefault(); goPage(page - step); }
      if (e.key === 'PageDown' && page < totalPages) { e.preventDefault(); goPage(page + step); }
      if (e.key === 'Home') goPage(1);
      if (e.key === 'End') goPage(totalPages);
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [page, book, goPage, step, totalPages, assignmentMode]);

  // 触摸滑动翻页
  const touchState = useRef<{ x: number; y: number; t: number } | null>(null);
  useEffect(() => {
    if (!book || assignmentMode) return;
    const el = mainRef.current;
    if (!el) return;
    const onStart = (e: TouchEvent) => {
      const t = e.touches[0];
      touchState.current = { x: t.clientX, y: t.clientY, t: Date.now() };
    };
    const onEnd = (e: TouchEvent) => {
      if (!touchState.current) return;
      const t = e.changedTouches[0];
      const dx = t.clientX - touchState.current.x;
      const dy = t.clientY - touchState.current.y;
      const dt = Date.now() - touchState.current.t;
      touchState.current = null;
      if (dt > 500 || Math.abs(dx) < 50 || Math.abs(dx) < Math.abs(dy) * 1.5) return;
      if (dx < 0 && page < totalPages) goPage(page + step);
      else if (dx > 0 && page > 1) goPage(page - step);
    };
    el.addEventListener('touchstart', onStart, { passive: true });
    el.addEventListener('touchend', onEnd, { passive: true });
    return () => {
      el.removeEventListener('touchstart', onStart);
      el.removeEventListener('touchend', onEnd);
    };
  }, [page, book, goPage, step, totalPages, assignmentMode]);

  // ── 批注 ──────────────────────────────────────────────────
  const reloadAnnotations = useCallback(async () => {
    const anns = await listAnnotations(bookId).catch(() => [] as PdfAnnotation[]);
    setAnnotations(anns);
  }, [bookId]);

  const handleSaveAnnotation = useCallback(async (data: { type: string; contentJson: Record<string, unknown> }) => {
    const fd = new FormData();
    fd.append('bookId', String(bookId));
    fd.append('pageNumber', String(page));
    fd.append('type', data.type);
    fd.append('contentJson', JSON.stringify(data.contentJson));
    try {
      await createAnnotation(fd);
      await reloadAnnotations();
      toast.success('批注已保存');
    } catch (e: any) {
      toast.error('批注保存失败: ' + (e?.message || ''));
    }
  }, [bookId, page, reloadAnnotations]);

  const handleCropSave = useCallback(async (
    blob: Blob,
    cropData: { x: number; y: number; w: number; h: number },
    subject: string,
    tags: string,
  ) => {
    const fd = new FormData();
    fd.append('image', blob, 'crop.png');
    fd.append('bookId', String(bookId));
    fd.append('pageNumber', String(page));
    fd.append('type', 'crop');
    fd.append('contentJson', JSON.stringify(cropData));
    fd.append('subject', subject);
    fd.append('tags', tags);
    try {
      await createAnnotation(fd);
      await reloadAnnotations();
      setTool('view');
      toast.success('错题已保存');
    } catch (e: any) {
      toast.error('保存失败: ' + (e?.message || ''));
    }
  }, [bookId, page, reloadAnnotations]);

  const handleMistakeToggle = async (id: number, current: number) => {
    try {
      await updateMistake(id, { reviewStatus: current === 0 ? 1 : 0 });
      await reloadAnnotations();
      toast.success(current === 0 ? '已标记为已掌握' : '已取消掌握标记');
    } catch (e: any) {
      toast.error('操作失败: ' + (e?.message || ''));
    }
  };

  const handleToggleFavorite = async () => {
    try {
      const res = await toggleFavorite(bookId);
      setIsFavorite(res.favorited);
    } catch (e: any) {
      toast.error(e?.message || '收藏操作失败');
    }
  };

  // ── 作业 ──────────────────────────────────────────────────
  useEffect(() => {
    if (!bookId) return;
    listAssignments(bookId, { pageSize: 200 })
      .then(({ data }) => {
        setAllAssignments(data);
        // 刷新后同步当前作业的实时状态（提交/批改后状态跟着变）
        setCurrentAssignment((cur) => {
          if (!cur) return cur;
          const fresh = data.find((a) => a.id === cur.id);
          return fresh ? { ...cur, ...fresh } : cur;
        });
      })
      .catch(() => {});
  }, [bookId, assignmentRefresh]);

  const enterAssignment = useCallback((a: PdfAssignment) => {
    setCurrentAssignment(a);
    setAssignmentMode(true);
    const target = Array.isArray(a.pages) ? a.pages.find((p) => Number.isInteger(p) && p > 0) : undefined;
    if (target) setPage(target);
  }, []);

  useEffect(() => {
    if (!book || !Number.isInteger(assignmentId) || assignmentId <= 0) return;
    if (currentAssignment?.id === assignmentId) return;
    let cancelled = false;
    getAssignment(assignmentId)
      .then((a) => {
        if (cancelled || a.bookId !== bookId) return;
        enterAssignment(a);
        setRightOpen(false);
      })
      .catch(() => { if (!cancelled) navigate(`/pdf/book/${bookId}`, { replace: true }); });
    return () => { cancelled = true; };
  }, [book, assignmentId, bookId, navigate, enterAssignment]);

  const buildAssignmentTitle = useCallback(() => {
    const d = new Date();
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
  }, []);

  const handleEnterAssignmentMode = useCallback(async () => {
    if (!book || creatingRef.current) return;
    creatingRef.current = true;
    setEnteringAssignment(true);
    try {
      // 与图片版一致：当前页已有未批改作业时，先弹「复用 / 新建」避免重复产生空作业
      const { data: all } = await listAssignments(bookId, { pageSize: 200 });
      const pageAssignments = all.filter((a) => Array.isArray(a.pages) && a.pages.includes(page));
      const ungraded = pageAssignments.filter((a) => a.status !== 'graded');
      if (ungraded.length > 0) {
        setAssignmentPrompt(ungraded[0]);
        return;
      }
      const a = await createAssignment(bookId, buildAssignmentTitle());
      setCurrentAssignment(a);
      setAssignmentMode(true);
      setRightTab('assignments');
      setAssignmentRefresh((v) => v + 1);
      setSearchParams({ assignmentId: String(a.id), role: canGrade ? 'teacher' : 'student' }, { replace: true });
    } catch (e: any) {
      toast.error('进入做题模式失败: ' + (e?.message || ''));
    } finally {
      creatingRef.current = false;
      setEnteringAssignment(false);
    }
  }, [book, bookId, page, setSearchParams, buildAssignmentTitle, canGrade]);

  const handleCreateNewAssignment = useCallback(async () => {
    if (creatingRef.current) return;
    creatingRef.current = true;
    setEnteringAssignment(true);
    try {
      const a = await createAssignment(bookId, buildAssignmentTitle());
      setCurrentAssignment(a);
      setAssignmentMode(true);
      setRightTab('assignments');
      setAssignmentRefresh((v) => v + 1);
      setSearchParams({ assignmentId: String(a.id), role: canGrade ? 'teacher' : 'student' }, { replace: true });
    } catch (e: any) {
      toast.error('新建作业失败: ' + (e?.message || ''));
    } finally {
      creatingRef.current = false;
      setEnteringAssignment(false);
    }
  }, [bookId, setSearchParams, buildAssignmentTitle, canGrade]);

  const enterExistingAssignment = useCallback((a: PdfAssignment) => {
    setAssignmentPrompt(null);
    setCurrentAssignment(a);
    setAssignmentMode(true);
    setRightTab('assignments');
    setSearchParams({ assignmentId: String(a.id), role: isTeacher ? 'teacher' : 'student' }, { replace: true });
  }, [setSearchParams, isTeacher]);

  const handleExitAssignmentMode = useCallback(() => {
    setSearchParams({}, { replace: true });
    setCurrentAssignment(null);
    setAssignmentMode(false);
    setRightOpen(true);
  }, [setSearchParams]);

  const pageAssignmentsMemo = useMemo(() => {
    const filtered = allAssignments.filter((a) => a.pages?.includes(page));
    if (currentAssignment && !filtered.some((a) => a.id === currentAssignment.id)) {
      return [currentAssignment, ...filtered];
    }
    return filtered;
  }, [allAssignments, page, currentAssignment]);

  useEffect(() => {
    if (!showAnnotations || !layers.annotations) setSelectedAnnotationId(null);
  }, [showAnnotations, layers.annotations]);

  const pagesWithAnnotations = useMemo(
    () => new Set(annotations.map((a) => a.pageNumber)),
    [annotations],
  );
  const annColorIndex = useMemo(() => buildAnnotationColorIndex(annotations as any), [annotations]);

  const pageAnnotations = annotations.filter(
    (a) => a.pageNumber === page || (isDouble && a.pageNumber === page + 1),
  );
  const leftPageAnnotations = annotations.filter((a) => a.pageNumber === page);
  const rightPageAnnotations = isDouble ? annotations.filter((a) => a.pageNumber === page + 1) : [];

  if (loadError) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 text-muted-foreground">
        <AlertTriangle size={40} />
        <p className="text-sm">加载失败：{loadError}</p>
        <button onClick={() => navigate('/pdf')} className="rounded-lg bg-primary px-3 py-1.5 text-sm text-white">
          返回书库
        </button>
      </div>
    );
  }

  if (!book || !doc) {
    return (
      <div className="flex h-full items-center justify-center text-muted-foreground">
        <div className="animate-pulse">加载中...</div>
      </div>
    );
  }

  const canvasProps = {
    doc,
    width: displayWidth,
    annotations,
    showAnnotations: showAnnotations && layers.annotations,
    colorIndex: annColorIndex,
    selectedAnnotationId,
    onAnnotationClick: setSelectedAnnotationId,
    onSaveAnnotation: handleSaveAnnotation,
  };

  return (
    <div className="flex h-full flex-col bg-background">
      {/* 顶栏 */}
      <header className="grid flex-shrink-0 select-none grid-cols-[1fr_auto_1fr] items-center gap-2 border-b border-border bg-card px-2 py-1.5 text-card-foreground">
        <div className="flex min-w-0 items-center gap-1">
          <button onClick={() => navigate('/pdf')} title="返回书库" className="flex-shrink-0 rounded p-1.5 text-muted-foreground transition hover:bg-muted hover:text-foreground">
            <ArrowLeft size={18} />
          </button>
          <button
            onClick={() => setLeftOpen(!leftOpen)}
            title="目录"
            className={`flex-shrink-0 rounded p-1.5 transition ${leftOpen ? 'bg-muted text-foreground' : 'text-muted-foreground hover:bg-muted hover:text-foreground'}`}
          >
            <PanelLeft size={18} />
          </button>
          <h1 className="truncate text-sm text-foreground" title={book.title}>{book.title}</h1>

          <button
            onClick={handleToggleFavorite}
            title={isFavorite ? '取消收藏' : '收藏'}
            className={`ml-1 flex-shrink-0 rounded p-1 transition ${isFavorite ? 'text-amber-500' : 'text-muted-foreground hover:text-amber-500'}`}
          >
            <Star size={14} className={isFavorite ? 'fill-amber-500' : ''} />
          </button>

          {book.searchable !== 'ok' && (
            <span
              className="ml-1 flex flex-shrink-0 items-center gap-0.5 rounded bg-slate-500/15 px-1.5 py-0.5 text-[10px] text-muted-foreground"
              title={SEARCHABLE_LABEL[book.searchable] || book.searchable}
            >
              <AlertTriangle size={9} /> 不可搜
            </span>
          )}
          {book.missing && (
            <span className="ml-1 flex flex-shrink-0 items-center gap-0.5 rounded bg-red-500/15 px-1.5 py-0.5 text-[10px] text-red-600">
              文件缺失
            </span>
          )}
        </div>

        {/* 翻页 */}
        <div className="flex flex-shrink-0 items-center gap-1">
          <button onClick={() => goPage(1)} disabled={page <= 1} title="第一页" className="rounded p-1.5 text-muted-foreground transition hover:bg-muted hover:text-foreground disabled:opacity-30">
            <ChevronFirst size={18} />
          </button>
          <button onClick={() => goPage(page - step)} disabled={page <= 1} title="上一页" className="rounded p-1.5 text-muted-foreground transition hover:bg-muted hover:text-foreground disabled:opacity-30">
            <ChevronLeft size={18} />
          </button>
          <div className="flex items-center gap-1 text-sm">
            <input
              type="number"
              value={page}
              min={1}
              max={totalPages}
              onChange={(e) => { const p = Number(e.target.value); if (p >= 1 && p <= totalPages) setPage(p); }}
              className="w-12 rounded border border-border bg-muted px-1 py-1 text-center text-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
            />
            {isDouble && page < totalPages && <span className="text-muted-foreground">-{Math.min(page + 1, totalPages)}</span>}
            <span className="text-muted-foreground">/ {totalPages}</span>
            {showAnnotations && layers.annotations && pagesWithAnnotations.has(page) && (
              <span className="ml-0.5 inline-block h-1.5 w-1.5 rounded-full bg-orange-400" title="本页有批注" />
            )}
          </div>
          <button onClick={() => goPage(page + step)} disabled={page >= totalPages} title="下一页" className="rounded p-1.5 text-muted-foreground transition hover:bg-muted hover:text-foreground disabled:opacity-30">
            <ChevronRight size={18} />
          </button>
          <button onClick={() => goPage(totalPages)} disabled={page >= totalPages} title="最后一页" className="rounded p-1.5 text-muted-foreground transition hover:bg-muted hover:text-foreground disabled:opacity-30">
            <ChevronLast size={18} />
          </button>
        </div>

        {/* 工具组 */}
        <div className="flex items-center justify-end gap-0.5">
          <button
            onClick={() => setTool('view')}
            title="浏览"
            className={`relative flex-shrink-0 rounded p-1.5 transition ${tool === 'view' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-muted hover:text-foreground'}`}
          >
            <MousePointer2 size={16} />
          </button>
          <button
            onClick={handleEnterAssignmentMode}
            title="做题"
            className="relative flex-shrink-0 rounded p-1.5 text-muted-foreground transition hover:bg-muted hover:text-foreground"
          >
            <PenLine size={16} />
          </button>
          <button
            onClick={() => setTool('note')}
            title="批注"
            className={`relative flex-shrink-0 rounded p-1.5 transition ${tool === 'note' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-muted hover:text-foreground'}`}
          >
            <StickyNote size={16} />
          </button>
          <button
            onClick={() => setTool('highlight')}
            title="高亮"
            className={`relative flex-shrink-0 rounded p-1.5 transition ${tool === 'highlight' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-muted hover:text-foreground'}`}
          >
            <Highlighter size={16} />
          </button>
          <button
            onClick={() => setTool('crop')}
            title="裁剪错题"
            className={`relative flex-shrink-0 rounded p-1.5 transition ${tool === 'crop' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-muted hover:text-foreground'}`}
          >
            <Scissors size={16} />
          </button>

          <div className="mx-0.5 h-5 w-px bg-muted" />

          <button onClick={zoomOut} title="缩小" className="relative flex-shrink-0 rounded p-1.5 text-muted-foreground transition hover:bg-muted hover:text-foreground">
            <ZoomOut size={16} />
          </button>
          {editingZoom ? (
            <input
              autoFocus
              value={zoomInput}
              onChange={(e) => setZoomInput(e.target.value.replace(/[^0-9]/g, ''))}
              onBlur={commitZoom}
              onKeyDown={(e) => {
                if (e.key === 'Enter') { e.preventDefault(); commitZoom(); }
                if (e.key === 'Escape') { e.preventDefault(); setEditingZoom(false); }
              }}
              className="w-12 flex-shrink-0 rounded border border-border bg-card px-1 text-center text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
            />
          ) : (
            <button
              onClick={startEditZoom}
              title="点击输入缩放比例"
              className="w-12 flex-shrink-0 rounded px-1 text-center text-xs text-muted-foreground hover:bg-muted hover:text-foreground"
            >
              {Math.round(snapZoom(zoom) * 100)}%
            </button>
          )}
          <button onClick={zoomIn} title="放大" className="relative flex-shrink-0 rounded p-1.5 text-muted-foreground transition hover:bg-muted hover:text-foreground">
            <ZoomIn size={16} />
          </button>
          <button
            onClick={() => setFitMode('page')}
            title="适应页面"
            className={`relative flex-shrink-0 rounded p-1.5 transition ${fitMode === 'page' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-muted hover:text-foreground'}`}
          >
            <Minimize2 size={16} />
          </button>
          <button
            onClick={() => setFitMode('width')}
            title="适应宽度"
            className={`relative flex-shrink-0 rounded p-1.5 transition ${fitMode === 'width' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-muted hover:text-foreground'}`}
          >
            <Maximize2 size={16} />
          </button>

          <div className="mx-0.5 h-5 w-px bg-muted" />

          <div className="relative flex-shrink-0">
            <button
              onClick={() => setLayerDropdownOpen(!layerDropdownOpen)}
              title="图层控制"
              className={`relative flex items-center gap-0.5 rounded p-1.5 transition ${Object.values(layers).some((v) => !v) ? 'bg-primary/15 text-primary' : 'text-muted-foreground hover:bg-muted hover:text-foreground'}`}
            >
              <Layers size={16} />
            </button>
            {layerDropdownOpen && (
              <>
                <div className="fixed inset-0 z-50" onClick={() => setLayerDropdownOpen(false)} />
                <div className="absolute right-0 top-full z-50 mt-1 w-36 rounded-lg border border-border bg-popover py-1 shadow-xl">
                  {[
                    { key: 'annotations' as const, label: '批注图层' },
                    { key: 'highlights' as const, label: '高亮图层' },
                    { key: 'assignments' as const, label: '做题图层' },
                    { key: 'grading' as const, label: '批改图层' },
                  ].map(({ key, label }) => (
                    <label key={key} className="flex cursor-pointer items-center gap-2 px-3 py-1.5 text-sm text-foreground hover:bg-muted">
                      <input
                        type="checkbox"
                        checked={layers[key]}
                        onChange={(e) => setLayers({ ...layers, [key]: e.target.checked })}
                        className="accent-blue-600"
                      />
                      {label}
                    </label>
                  ))}
                </div>
              </>
            )}
          </div>

          <button
            onClick={() => setPageLayout('single')}
            title="单页"
            className={`relative flex-shrink-0 rounded p-1.5 transition ${pageLayout === 'single' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-muted hover:text-foreground'}`}
          >
            <Book size={16} />
          </button>
          <button
            onClick={() => setPageLayout('double')}
            title="双页"
            className={`relative flex-shrink-0 rounded p-1.5 transition ${pageLayout === 'double' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-muted hover:text-foreground'}`}
          >
            <BookOpen size={16} />
          </button>

          <div className="mx-0.5 h-5 w-px bg-muted" />

          <div className="relative flex-shrink-0">
            <button
              onClick={() => setMoreOpen(!moreOpen)}
              title="更多"
              className="relative flex items-center rounded p-1.5 text-muted-foreground transition hover:bg-muted hover:text-foreground"
            >
              <MoreVertical size={16} />
            </button>
            {moreOpen && (
              <>
                <div className="fixed inset-0 z-50" onClick={() => setMoreOpen(false)} />
                <div className="absolute right-0 top-full z-50 mt-1 w-44 rounded-lg border border-border bg-popover py-1 shadow-xl">
                  <button
                    onClick={() => { setRotation((r) => r + 90); setMoreOpen(false); }}
                    className="flex w-full items-center gap-2 px-3 py-2 text-sm text-foreground transition hover:bg-muted"
                  >
                    <RotateCw size={14} /> 顺时针旋转 90°
                  </button>
                  <button
                    onClick={() => { setRotation((r) => r - 90); setMoreOpen(false); }}
                    className="flex w-full items-center gap-2 px-3 py-2 text-sm text-foreground transition hover:bg-muted"
                  >
                    <RotateCcw size={14} /> 逆时针旋转 90°
                  </button>
                  <button
                    disabled={book.missing}
                    aria-disabled={book.missing}
                    onClick={() => { if (!book.missing) { window.open(pdfFileUrl(bookId), '_blank'); setMoreOpen(false); } }}
                    className={`flex w-full items-center gap-2 px-3 py-2 text-sm transition ${
                      book.missing
                        ? 'cursor-not-allowed text-muted-foreground/50'
                        : 'text-foreground hover:bg-muted'
                    }`}
                  >
                    <Download size={14} /> {book.missing ? '暂无 PDF' : '下载原 PDF'}
                  </button>
                </div>
              </>
            )}
          </div>

          <button
            onClick={() => setRightOpen(!rightOpen)}
            title="作业 / 错题 / 批注"
            className={`relative flex-shrink-0 rounded p-1.5 transition ${rightOpen ? 'bg-muted text-foreground' : 'text-muted-foreground hover:bg-muted hover:text-foreground'}`}
          >
            <PanelRight size={18} />
          </button>
        </div>
      </header>

      <div className="flex flex-1 overflow-hidden">
        {leftOpen && (
          <aside
            style={{ width: leftWidth }}
            className="relative flex flex-shrink-0 flex-col border-r border-sidebar-border bg-sidebar text-sidebar-foreground"
          >
            <PdfTocTree
              toc={book.tocJson || []}
              currentPage={page}
              totalPages={totalPages}
              bookId={bookId}
              searchable={book.searchable === 'ok'}
              view={leftView}
              onViewChange={setLeftView}
              onPageSelect={(p) => goPage(p)}
            />
            <div
              onMouseDown={startResize}
              title="拖动调整侧栏宽度"
              className="absolute right-0 top-0 z-10 h-full w-1.5 cursor-col-resize bg-transparent transition-colors hover:bg-blue-500/50 active:bg-blue-500"
            />
          </aside>
        )}

        <main ref={mainRef} className="flex-1 overflow-auto">
          <div className="flex min-h-full items-center justify-center p-4">
            <div className="relative flex items-center justify-center gap-2">
              {tool === 'crop' ? (
                <div style={{ transform: `rotate(${rotation}deg)`, transformOrigin: 'center center' }}>
                  <PdfCropTool
                    doc={doc}
                    pageNumber={page}
                    width={displayWidth}
                    onSave={handleCropSave}
                    onCancel={() => setTool('view')}
                  />
                </div>
              ) : (
                <div
                  className="flex gap-1"
                  style={{ transform: `rotate(${rotation}deg)`, transformOrigin: 'center center', transition: 'transform 0.2s ease' }}
                >
                  {isDouble ? (
                    <>
                      <PdfPageCanvas {...canvasProps} pageNumber={page} tool={tool} />
                      <PdfPageCanvas {...canvasProps} pageNumber={page + 1} tool="view" />
                    </>
                  ) : (
                    <PdfPageCanvas {...canvasProps} pageNumber={page} tool={tool} />
                  )}
                </div>
              )}

              {/* 批注侧面板 */}
              {showAnnotations && layers.annotations && tool === 'view' &&
                (isDouble ? rightPageAnnotations : leftPageAnnotations).length > 0 && (
                <div className="order-last w-56 flex-shrink-0 max-h-full overflow-auto scrollbar-thin">
                  <div className="space-y-2">
                    {(isDouble ? rightPageAnnotations : leftPageAnnotations).map((ann) => {
                      const ci = annColorIndex.get(ann.id) ?? 0;
                      const color = getAnnotationColor(ci);
                      const isSelected = selectedAnnotationId === ann.id;
                      return (
                        <div
                          key={ann.id}
                          data-annotation-id={ann.id}
                          onClick={() => setSelectedAnnotationId(isSelected ? null : ann.id)}
                          className={`cursor-pointer rounded-lg border p-2.5 shadow-sm transition ${
                            isSelected ? `${color.border} ${color.bg} ring-2 ring-offset-1 shadow-md` : `${color.border} ${color.bg} hover:shadow-md`
                          }`}
                        >
                          <div className="mb-1 flex items-center gap-1.5">
                            <span className={`inline-flex h-4 w-4 items-center justify-center rounded-full text-[9px] font-bold text-white ${color.dot}`}>
                              {ci + 1}
                            </span>
                            <span className={`text-xs font-medium ${color.text}`}>第 {ann.pageNumber} 页</span>
                          </div>
                          {ann.type === 'note' && (
                            <p className="whitespace-pre-wrap break-words text-xs leading-relaxed text-foreground">
                              {(ann.contentJson as any).text}
                            </p>
                          )}
                          {ann.type === 'highlight' && <span className="text-xs text-muted-foreground">高亮区域</span>}
                          {ann.type === 'crop' && <span className="text-xs text-blue-500">错题裁剪</span>}
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          </div>
        </main>

        {rightOpen && (
          <aside className="flex w-72 flex-shrink-0 flex-col border-l border-border bg-card">
            <div className="flex items-center border-b border-border">
              <button
                onClick={() => setRightTab('assignments')}
                className={`flex-1 py-2.5 text-sm font-medium transition ${rightTab === 'assignments' ? 'border-b-2 border-primary text-primary' : 'text-muted-foreground hover:text-foreground'}`}
              >
                作业 ({assignmentCount})
              </button>
              <button
                onClick={() => setRightTab('annotations')}
                title="批注与错题（错题为已裁剪的批注）"
                className={`flex-1 py-2.5 text-sm font-medium transition ${rightTab === 'annotations' ? 'border-b-2 border-primary text-primary' : 'text-muted-foreground hover:text-foreground'}`}
              >
                错题批注 ({annotations.length})
              </button>
            </div>
            <div className="flex-1 overflow-auto scrollbar-thin">
              {rightTab === 'assignments' ? (
                <PdfAssignmentList
                  bookId={bookId}
                  onSelect={(a) => {
                    enterAssignment(a);
                    setRightTab('assignments');
                    setSearchParams({ assignmentId: String(a.id), role: isTeacher ? 'teacher' : 'student' }, { replace: true });
                  }}
                  selectedId={currentAssignment?.id ?? null}
                  onRefresh={assignmentRefresh}
                  onCountChange={setAssignmentCount}
                />
              ) : (
                <PdfAnnotationList
                  annotations={annotations}
                  colorIndex={annColorIndex}
                  currentPage={page}
                  isDouble={isDouble}
                  selectedAnnotationId={selectedAnnotationId}
                  onSelect={setSelectedAnnotationId}
                  onNavigate={(p) => { setTool('view'); setShowAnnotations(true); skipClearRef.current = true; goPage(p); }}
                  onDelete={setDeleteAnnId}
                  onToggleMistake={handleMistakeToggle}
                />
              )}
            </div>
          </aside>
        )}
      </div>

      {/* 删除批注确认 */}
      {deleteAnnId !== null && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={() => setDeleteAnnId(null)}>
          <div className="w-80 rounded-xl bg-card p-5 shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <h3 className="mb-2 text-base font-semibold text-foreground">确认删除批注</h3>
            <p className="mb-4 text-sm text-muted-foreground">删除后无法恢复，确定要删除这条批注吗？</p>
            <div className="flex justify-end gap-2">
              <button onClick={() => setDeleteAnnId(null)} className="rounded-lg border border-border px-3 py-1.5 text-sm text-muted-foreground hover:bg-muted">取消</button>
              <button
                onClick={async () => {
                  try {
                    await deleteAnnotation(deleteAnnId);
                    await reloadAnnotations();
                    toast.success('批注已删除');
                  } catch (e: any) {
                    toast.error('删除失败: ' + (e?.message || ''));
                  }
                  setDeleteAnnId(null);
                  setSelectedAnnotationId(null);
                }}
                className="rounded-lg bg-red-500 px-3 py-1.5 text-sm text-white hover:bg-red-600"
              >
                删除
              </button>
            </div>
          </div>
        </div>
      )}

      {assignmentMode && currentAssignment && (
        <PdfAssignmentMode
          bookId={bookId}
          bookTitle={book.title}
          canGrade={canGrade}
          totalPages={totalPages}
          doc={doc}
          currentPage={page}
          setCurrentPage={goPage}
          assignment={currentAssignment}
          onExit={handleExitAssignmentMode}
          onAssignmentUpdate={() => setAssignmentRefresh((v) => v + 1)}
          pageAssignments={pageAssignmentsMemo}
          onSwitchAssignment={(a) => { if (a) setCurrentAssignment(a); }}
        />
      )}

      {/* 复用 / 新建 作业提示（与图片版一致：当前页已有未批改作业时弹出） */}
      {assignmentPrompt && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={() => setAssignmentPrompt(null)}>
          <div className="relative w-80 rounded-xl bg-card p-5 shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <button onClick={() => setAssignmentPrompt(null)} className="absolute right-3 top-3 rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground">
              <X size={16} />
            </button>
            <h3 className="mb-2 text-base font-semibold text-foreground">当前页已有未批改作业</h3>
            <p className="mb-4 text-sm text-muted-foreground">{assignmentPrompt.title || `作业 #${assignmentPrompt.id}`}</p>
            <div className="flex justify-end gap-2">
              <button
                onClick={() => enterExistingAssignment(assignmentPrompt)}
                className="rounded-lg bg-primary px-3 py-1.5 text-sm text-primary-foreground hover:bg-primary/90"
              >
                复用
              </button>
              <button
                disabled={enteringAssignment}
                onClick={async () => { setAssignmentPrompt(null); await handleCreateNewAssignment(); }}
                className="rounded-lg border border-border px-3 py-1.5 text-sm text-muted-foreground hover:bg-muted disabled:cursor-wait disabled:opacity-40"
              >
                新建
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// 右侧栏：批注 / 错题列表
// ─────────────────────────────────────────────────────────────

function formatAnnotationTime(iso: string | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  const y = new Date(now.getTime() - 86400000);
  const isYesterday = d.toDateString() === y.toDateString();
  const hm = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  if (sameDay) return `今天 ${hm}`;
  if (isYesterday) return `昨天 ${hm}`;
  return `${d.getMonth() + 1}/${d.getDate()} ${hm}`;
}

function PdfAnnotationList({
  annotations, colorIndex, currentPage, isDouble,
  selectedAnnotationId, onSelect, onNavigate, onDelete, onToggleMistake,
}: {
  annotations: PdfAnnotation[];
  colorIndex: Map<number, number>;
  currentPage: number;
  isDouble: boolean;
  selectedAnnotationId: number | null;
  onSelect: (id: number | null) => void;
  onNavigate: (page: number) => void;
  onDelete: (id: number) => void;
  onToggleMistake: (id: number, status: number) => void;
}) {
  if (annotations.length === 0) {
    return <div className="p-4 text-center text-sm text-muted-foreground">暂无批注</div>;
  }

  return (
    <div className="space-y-2 p-2">
      {annotations.map((ann) => {
        const isCurrent = ann.pageNumber === currentPage || (isDouble && ann.pageNumber === currentPage + 1);
        const isSelected = selectedAnnotationId === ann.id;
        const ci = colorIndex.get(ann.id) ?? 0;
        const color = getAnnotationColor(ci);
        const mistake = ann.type === 'crop' ? (ann.mistakes?.[0] ?? null) : null;

        const handleClick = () => {
          if (isSelected) { onSelect(null); return; }
          onSelect(ann.id);
          const visible = isDouble
            ? ann.pageNumber === currentPage || ann.pageNumber === currentPage + 1
            : ann.pageNumber === currentPage;
          if (!visible) onNavigate(ann.pageNumber);
        };

        const rowClass = isSelected
          ? `${color.bg} ${color.border} ring-2 ring-offset-1`
          : isCurrent
            ? 'bg-blue-500/10 border-blue-500/30'
            : 'bg-muted/50 border-border hover:bg-muted';

        if (ann.type === 'crop') {
          return (
            <div key={ann.id} className={`flex cursor-pointer gap-2 rounded-lg border p-2 transition ${rowClass}`} onClick={handleClick}>
              <div className="flex h-16 w-16 flex-shrink-0 items-center justify-center overflow-hidden rounded border border-amber-500/20 bg-amber-500/10">
                {mistake?.imageUrl ? (
                  <img
                    src={withToken(mistake.imageUrl)}
                    alt="错题"
                    className="h-full w-full object-cover"
                    onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
                  />
                ) : (
                  <span className="text-xs text-amber-400">无图</span>
                )}
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-medium text-foreground">{mistake?.subject || '未分类'}</span>
                  <span className={`rounded px-1.5 py-0.5 text-xs ${isCurrent ? 'bg-primary/15 text-primary' : 'bg-muted text-muted-foreground'}`}>
                    第 {ann.pageNumber} 页
                  </span>
                </div>
                {ann.tags && <div className="mt-0.5 truncate text-xs text-muted-foreground">{ann.tags}</div>}
                {ann.createdAt && <div className="mt-0.5 text-xs text-muted-foreground/70">{formatAnnotationTime(ann.createdAt)}</div>}
                <div className="mt-1 flex items-center gap-2">
                  {mistake && (
                    <button
                      onClick={(e) => { e.stopPropagation(); onToggleMistake(mistake.id, mistake.reviewStatus); }}
                      className={`flex items-center gap-1 text-xs transition ${mistake.reviewStatus === 1 ? 'text-primary' : 'text-muted-foreground hover:text-primary'}`}
                    >
                      {mistake.reviewStatus === 1 ? <CheckCircle2 size={14} /> : <Circle size={14} />}
                      {mistake.reviewStatus === 1 ? '已掌握' : '未复习'}
                    </button>
                  )}
                  <button
                    onClick={(e) => { e.stopPropagation(); onDelete(ann.id); }}
                    className="text-muted-foreground/60 opacity-0 transition hover:text-red-500 group-hover:opacity-100"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              </div>
            </div>
          );
        }

        return (
          <div key={ann.id} className={`flex cursor-pointer items-start gap-2 rounded-lg border-l-4 p-3 transition ${rowClass}`} onClick={handleClick}>
            <div className="mt-0.5 flex flex-shrink-0 items-center gap-1">
              {ann.type === 'note' && <StickyNote size={16} className="text-amber-500" />}
              {ann.type === 'highlight' && <Highlighter size={16} className="text-yellow-500" />}
              <span className={`inline-flex h-4 w-4 items-center justify-center rounded-full text-[9px] font-bold text-white ${color.dot}`}>
                {ci + 1}
              </span>
            </div>
            <div className="min-w-0 flex-1">
              {ann.type === 'note' && (
                <p className="whitespace-pre-wrap break-words text-sm text-foreground">{(ann.contentJson as any).text}</p>
              )}
              {ann.type === 'highlight' && <span className="text-xs text-muted-foreground">高亮区域</span>}
              <div className="mt-1 flex items-center gap-2">
                <span className={`rounded px-1.5 py-0.5 text-xs ${isCurrent ? 'bg-primary/15 text-primary' : 'text-muted-foreground'}`}>
                  第 {ann.pageNumber} 页
                </span>
                {ann.tags && <span className="truncate text-xs text-muted-foreground">{ann.tags}</span>}
                {ann.createdAt && <span className="text-xs text-muted-foreground/70">{formatAnnotationTime(ann.createdAt)}</span>}
              </div>
            </div>
            <button
              onClick={(e) => { e.stopPropagation(); onDelete(ann.id); }}
              className="flex-shrink-0 text-muted-foreground/60 opacity-0 transition hover:text-red-500 group-hover:opacity-100"
            >
              <Trash2 size={14} />
            </button>
          </div>
        );
      })}
    </div>
  );
}
