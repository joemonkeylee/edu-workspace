import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { getBookVideos, videoStreamUrl, saveVideoProgress, setVideoCompleted } from '../api/client';
import type { BookVideo, VideoReadiness } from '../api/client';
import { Play, AlertTriangle, CheckCircle2, Circle, Loader2 } from 'lucide-react';
import { toast } from 'sonner';

interface Props {
  bookId: number;
}

/** 播放进度上报节流窗口（ms） */
const REPORT_INTERVAL = 5000;

const STATUS_LABEL: Record<string, { text: string; cls: string }> = {
  not_started: { text: '未开始', cls: 'text-gray-400' },
  in_progress: { text: '学习中', cls: 'text-blue-600' },
  watched: { text: '已看完', cls: 'text-teal-600' },
  completed: { text: '已完成', cls: 'text-emerald-600' },
};

/**
 * 讲解视频面板：本讲/本课程关联的讲解视频列表 + 内嵌播放器 + 学习进度。
 * 进度按视频身份记录（同一个视频被多本教材引用时进度共享），
 * 书的学习情况由它关联的多个视频聚合而成。
 */
export default function VideoListPanel({ bookId }: Props) {
  const [videos, setVideos] = useState<BookVideo[]>([]);
  const [readiness, setReadiness] = useState<VideoReadiness | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeId, setActiveId] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);

  const videoRef = useRef<HTMLVideoElement>(null);
  const activeRef = useRef<BookVideo | null>(null);
  const lastReportRef = useRef(0);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { videos: list, readiness: rd } = await getBookVideos(bookId);
      setVideos(list);
      setReadiness(rd);
      const first = list.find((v) => !v.missing) || list[0];
      setActiveId((prev) => (prev && list.some((v) => v.id === prev) ? prev : first?.id ?? null));
    } catch {
      setVideos([]);
    } finally {
      setLoading(false);
    }
  }, [bookId]);

  useEffect(() => { load(); }, [load]);

  const active = videos.find((v) => v.id === activeId) || null;
  activeRef.current = active;

  // 书级学习进度：对可用视频求完成度均值
  const summary = useMemo(() => {
    const usable = videos.filter((v) => !v.missing);
    let done = 0, watched = 0, inProgress = 0, frac = 0;
    for (const v of usable) {
      const p = v.progress;
      if (p?.completed) done += 1;
      else if (p?.watched) watched += 1;
      else if (p && p.positionSec > 0) inProgress += 1;
      frac += p ? p.percent / 100 : 0;
    }
    return {
      total: usable.length,
      done,
      watched,
      inProgress,
      percent: usable.length ? Math.round((frac / usable.length) * 100) : 0,
    };
  }, [videos]);

  /** 上报播放进度（节流；force 用于暂停 / 播完 / 切换视频） */
  const report = useCallback(async (force = false) => {
    const el = videoRef.current;
    const cur = activeRef.current;
    if (!el || !cur || !Number.isFinite(el.duration) || el.duration <= 0) return;
    const now = Date.now();
    if (!force && now - lastReportRef.current < REPORT_INTERVAL) return;
    lastReportRef.current = now;
    try {
      const info = await saveVideoProgress(cur.id, el.currentTime, el.duration);
      setVideos((list) => list.map((v) => (v.id === cur.id ? { ...v, progress: info } : v)));
    } catch {
      /* 进度上报失败静默处理，不打断播放 */
    }
  }, []);

  // 切换视频前把上一个视频的进度落库
  useEffect(() => {
    return () => { report(true); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeId]);

  const onLoadedMetadata = () => {
    const el = videoRef.current;
    const cur = activeRef.current;
    if (!el || !cur) return;
    const p = cur.progress;
    // 续播：上次位置有效且未播完时跳回
    if (p && p.positionSec > 3 && Number.isFinite(el.duration) && p.positionSec < el.duration - 3) {
      el.currentTime = p.positionSec;
    }
  };

  const toggleComplete = async () => {
    if (!active) return;
    const next = !active.progress?.completed;
    setBusy(true);
    try {
      const info = await setVideoCompleted(active.id, next, bookId);
      setVideos((list) => list.map((v) => (v.id === active.id ? { ...v, progress: info } : v)));
      toast.success(next ? '已标记完成' : '已取消完成');
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : '操作失败');
    } finally {
      setBusy(false);
    }
  };

  if (loading) {
    return <div className="p-4 text-xs text-gray-500">加载视频...</div>;
  }
  if (videos.length === 0) {
    return <div className="p-4 text-xs text-gray-500">这本书还没有关联讲解视频</div>;
  }

  const isCompleted = Boolean(active?.progress?.completed);
  const canComplete = readiness?.ready ?? false;

  return (
    <div className="flex flex-col h-full bg-white">
      {/* 学习进度总览 */}
      {summary.total > 0 && (
        <div className="px-2 py-1.5 border-b border-gray-200 bg-gray-50">
          <div className="flex items-center justify-between text-[11px] text-gray-600">
            <span>
              已完成 <span className="font-semibold text-emerald-600">{summary.done}</span>/{summary.total} 讲
              {summary.watched > 0 && <span className="ml-1 text-teal-600">· 已看完 {summary.watched}</span>}
            </span>
            <span className="tabular-nums font-medium text-gray-700">{summary.percent}%</span>
          </div>
          <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-gray-200">
            <div
              className="h-full rounded-full bg-emerald-500 transition-all"
              style={{ width: `${summary.percent}%` }}
            />
          </div>
        </div>
      )}

      {active && (
        <div className="p-2 border-b border-gray-200">
          {active.missing ? (
            <div className="flex items-start gap-1.5 rounded bg-amber-50 px-2 py-2 text-[11px] text-amber-700 border border-amber-200">
              <AlertTriangle size={13} className="flex-shrink-0 mt-0.5" />
              <span className="break-all">视频文件不存在：{active.fileName}</span>
            </div>
          ) : (
            <video
              ref={videoRef}
              key={active.id}
              controls
              preload="metadata"
              src={videoStreamUrl(active.id)}
              className="w-full rounded bg-black"
              onLoadedMetadata={onLoadedMetadata}
              onTimeUpdate={() => report(false)}
              onPause={() => report(true)}
              onEnded={() => report(true)}
            />
          )}
          <div className="mt-1 text-[11px] text-gray-600 line-clamp-2" title={active.title}>
            {active.title}
          </div>

          {/* 手动完成：需作业做完 + 错题整理完 */}
          <div className="mt-1.5 flex items-center gap-2">
            <button
              onClick={toggleComplete}
              disabled={busy || (!canComplete && !isCompleted)}
              title={
                isCompleted
                  ? '取消完成标记'
                  : canComplete
                    ? '作业与错题均已处理，可标记完成'
                    : '需先做完作业并整理完错题'
              }
              className={`flex items-center gap-1 rounded px-2 py-1 text-[11px] font-medium transition ${
                isCompleted
                  ? 'bg-emerald-600 text-white hover:bg-emerald-700'
                  : canComplete
                    ? 'bg-emerald-50 text-emerald-700 border border-emerald-300 hover:bg-emerald-100'
                    : 'bg-gray-100 text-gray-400 border border-gray-200 cursor-not-allowed'
              }`}
            >
              {busy ? <Loader2 size={12} className="animate-spin" /> : isCompleted ? <CheckCircle2 size={12} /> : <Circle size={12} />}
              {isCompleted ? '已完成' : '标记完成'}
            </button>
            {readiness && (
              <span className="text-[10px] text-gray-400 truncate" title="标记完成需作业全部做完、错题全部整理完">
                作业 {readiness.assignmentsDone}/{readiness.assignmentsTotal} · 错题 {readiness.mistakesDone}/{readiness.mistakesTotal}
              </span>
            )}
          </div>
        </div>
      )}

      <div className="flex-1 overflow-auto scrollbar-thin py-1">
        {videos.map((v, i) => {
          const st = STATUS_LABEL[v.progress?.status ?? 'not_started'];
          const pct = v.missing ? 0 : v.progress?.percent ?? 0;
          return (
            <button
              key={v.id}
              onClick={() => setActiveId(v.id)}
              className={`w-full text-left flex items-start gap-1.5 px-2 py-1.5 text-xs transition border-l-2 ${
                v.id === activeId
                  ? 'bg-blue-50 text-blue-700 border-blue-500'
                  : 'text-gray-700 hover:bg-gray-100 border-transparent'
              }`}
            >
              <span className="text-gray-400 tabular-nums flex-shrink-0">{v.lessonNo ?? i + 1}</span>
              <span className="flex-1 min-w-0">
                <span className="flex items-center gap-1">
                  <Play size={10} className="flex-shrink-0 opacity-70" />
                  <span className="truncate">{v.title}</span>
                </span>
                {/* 每条视频的进度条 + 状态 */}
                <span className="mt-1 flex items-center gap-1.5">
                  <span className="h-1 flex-1 overflow-hidden rounded-full bg-gray-200">
                    <span
                      className={`block h-full rounded-full ${v.progress?.completed ? 'bg-emerald-500' : 'bg-blue-400'}`}
                      style={{ width: `${pct}%` }}
                    />
                  </span>
                  <span className={`flex-shrink-0 text-[10px] ${st.cls}`}>
                    {v.missing ? '文件缺失' : st.text}
                  </span>
                </span>
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
