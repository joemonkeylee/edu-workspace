import { useState, useEffect, useCallback } from 'react';
import { getBookVideos, videoStreamUrl } from '../api/client';
import type { BookVideo } from '../api/client';
import { Play, AlertTriangle, Video } from 'lucide-react';

interface Props {
  bookId: number;
}

/** 左侧栏「视频」标签：本讲/本课程关联的讲解视频列表 + 内嵌播放器 */
export default function VideoListPanel({ bookId }: Props) {
  const [videos, setVideos] = useState<BookVideo[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeId, setActiveId] = useState<number | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const list = await getBookVideos(bookId);
      setVideos(list);
      const first = list.find((v) => !v.missing) || list[0];
      setActiveId((prev) => (prev && list.some((v) => v.id === prev) ? prev : first?.id ?? null));
    } catch {
      setVideos([]);
    } finally {
      setLoading(false);
    }
  }, [bookId]);

  useEffect(() => { load(); }, [load]);

  if (loading) {
    return <div className="p-4 text-xs text-gray-400">加载视频...</div>;
  }
  if (videos.length === 0) {
    return <div className="p-4 text-xs text-gray-400">这本书还没有关联讲解视频</div>;
  }

  const active = videos.find((v) => v.id === activeId) || null;

  return (
    <div className="flex flex-col h-full">
      {active && (
        <div className="p-2 border-b border-black/20">
          {active.missing ? (
            <div className="flex items-start gap-1.5 rounded bg-amber-500/15 px-2 py-2 text-[11px] text-amber-300">
              <AlertTriangle size={13} className="flex-shrink-0 mt-0.5" />
              <span className="break-all">视频文件不存在：{active.fileName}</span>
            </div>
          ) : (
            <video
              key={active.id}
              controls
              preload="metadata"
              src={videoStreamUrl(active.id)}
              className="w-full rounded bg-black"
            />
          )}
          <div className="mt-1 text-[11px] text-gray-300 line-clamp-2" title={active.title}>
            {active.title}
          </div>
        </div>
      )}

      <div className="flex-1 overflow-auto scrollbar-thin py-1">
        {videos.map((v, i) => (
          <button
            key={v.id}
            onClick={() => setActiveId(v.id)}
            className={`w-full text-left flex items-start gap-1.5 px-2 py-1.5 text-xs transition border-l-2 ${
              v.id === activeId
                ? 'bg-primary/30 text-white border-primary'
                : 'text-gray-300 hover:bg-white/5 border-transparent'
            }`}
          >
            <span className="text-gray-500 tabular-nums flex-shrink-0">{v.lessonNo ?? i + 1}</span>
            <span className="flex-1 min-w-0">
              <span className="flex items-center gap-1">
                <Play size={10} className="flex-shrink-0 opacity-70" />
                <span className="truncate">{v.title}</span>
              </span>
              {v.missing && <span className="text-[10px] text-amber-400">文件缺失</span>}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}
