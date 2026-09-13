import { useState, useMemo, useCallback, Fragment } from 'react';
import type { PreviewFile, VideoPlanItemPayload } from '../../api/client';
import { X, Check, Copy, ChevronDown, ChevronRight, Video, FileText, Layers, Search } from 'lucide-react';

interface Props {
  files: PreviewFile[];
  videoRoot: string;
  onCancel: () => void;
  onConfirm: (items: VideoPlanItemPayload[]) => void;
}

type FilterKey = 'all' | 'unmatched' | 'matched' | 'course';

/** 预处理页：让用户逐条确认 PDF 与 MP4 的对应关系，确认后才真正入库 */
export default function VideoMatchReview({ files, videoRoot, onCancel, onConfirm }: Props) {
  const [selection, setSelection] = useState<Record<string, Record<string, boolean>>>(() => {
    const init: Record<string, Record<string, boolean>> = {};
    for (const f of files) {
      const row: Record<string, boolean> = {};
      for (const v of f.videoMatches || []) row[v.filePath] = v.selected;
      init[f.fullPath] = row;
    }
    return init;
  });
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [filter, setFilter] = useState<FilterKey>('all');
  const [keyword, setKeyword] = useState('');
  const [copied, setCopied] = useState(false);

  const rows = useMemo(() => {
    return files.map((f) => {
      const matches = f.videoMatches || [];
      const picked = matches.filter((m) => selection[f.fullPath]?.[m.filePath]);
      return {
        file: f,
        matches,
        pickedCount: picked.length,
        isCourse: f.videoScope === 'course',
      };
    });
  }, [files, selection]);

  const stats = useMemo(() => {
    const lesson = rows.filter((r) => !r.isCourse);
    const course = rows.filter((r) => r.isCourse);
    return {
      pdfs: rows.length,
      lesson: lesson.length,
      course: course.length,
      unmatched: lesson.filter((r) => r.pickedCount === 0).length,
      links: rows.reduce((s, r) => s + r.pickedCount, 0),
    };
  }, [rows]);

  const visibleRows = useMemo(() => {
    const kw = keyword.trim().toLowerCase();
    return rows.filter((r) => {
      if (filter === 'unmatched' && (r.isCourse || r.pickedCount > 0)) return false;
      if (filter === 'matched' && r.pickedCount === 0) return false;
      if (filter === 'course' && !r.isCourse) return false;
      if (kw) {
        const hay = (r.file.fileName + ' ' + r.matches.map((m) => m.fileName).join(' ')).toLowerCase();
        if (!hay.includes(kw)) return false;
      }
      return true;
    });
  }, [rows, filter, keyword]);

  const toggleVideo = useCallback((pdfPath: string, videoPath: string) => {
    setSelection((prev) => {
      const row = { ...(prev[pdfPath] || {}) };
      row[videoPath] = !row[videoPath];
      return { ...prev, [pdfPath]: row };
    });
  }, []);

  const setRowAll = useCallback((pdfPath: string, matches: { filePath: string }[], value: boolean) => {
    setSelection((prev) => {
      const row = { ...(prev[pdfPath] || {}) };
      for (const m of matches) row[m.filePath] = value;
      return { ...prev, [pdfPath]: row };
    });
  }, []);

  const buildItems = useCallback((): VideoPlanItemPayload[] => {
    return files.map((f) => ({
      pdfPath: f.fullPath,
      scope: f.videoScope === 'course' ? 'course' : 'lesson',
      videos: (f.videoMatches || [])
        .filter((m) => selection[f.fullPath]?.[m.filePath])
        .map((m) => ({ filePath: m.filePath, title: m.title, lessonNo: m.lessonNo, score: m.score })),
    }));
  }, [files, selection]);

  const handleCopy = () => {
    const lines: string[] = ['PDF文件\t视频文件'];
    for (const f of files) {
      const picked = (f.videoMatches || []).filter((m) => selection[f.fullPath]?.[m.filePath]);
      if (picked.length === 0) {
        lines.push(`${f.fullPath}\t`);
        continue;
      }
      for (const m of picked) lines.push(`${f.fullPath}\t${m.filePath}`);
    }
    navigator.clipboard.writeText(lines.join('\n')).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  const filters: { key: FilterKey; label: string; count: number }[] = [
    { key: 'all', label: '全部', count: rows.length },
    { key: 'unmatched', label: '未匹配', count: stats.unmatched },
    { key: 'matched', label: '已匹配', count: rows.length - stats.unmatched },
    { key: 'course', label: '讲义/合集', count: stats.course },
  ];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-6xl max-h-[90vh] flex flex-col">
        <div className="flex items-start justify-between gap-4 px-6 py-4 border-b border-gray-200">
          <div>
            <h3 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
              <Video size={18} className="text-primary" />
              视频关联预处理
            </h3>
            <p className="text-xs text-gray-500 mt-1">
              共 {stats.pdfs} 个 PDF（讲次型 {stats.lesson} / 讲义合集 {stats.course}），已选 {stats.links} 条关联
              {stats.unmatched > 0 && <span className="ml-1 text-amber-600">· {stats.unmatched} 个讲次型 PDF 还没有视频</span>}
            </p>
            <p className="text-xs text-gray-400 mt-0.5">资源根目录：{videoRoot}</p>
          </div>
          <button onClick={onCancel} className="text-gray-400 hover:text-gray-600 p-1" title="关闭">
            <X size={20} />
          </button>
        </div>

        <div className="flex items-center gap-2 px-6 py-2 border-b border-gray-100 bg-gray-50">
          {filters.map((f) => (
            <button
              key={f.key}
              onClick={() => setFilter(f.key)}
              className={`px-2.5 py-1 rounded text-xs transition ${
                filter === f.key ? 'bg-primary text-white' : 'bg-white text-gray-600 hover:bg-gray-100 border border-gray-200'
              }`}
            >
              {f.label} {f.count}
            </button>
          ))}
          <div className="relative ml-auto">
            <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              value={keyword}
              onChange={(e) => setKeyword(e.target.value)}
              placeholder="搜索文件名"
              className="pl-8 pr-3 py-1 text-xs border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-primary w-56"
            />
          </div>
          <button
            onClick={handleCopy}
            className="flex items-center gap-1 px-2.5 py-1 text-xs rounded border border-gray-300 bg-white text-gray-600 hover:bg-gray-100 transition"
            title="复制全部对应关系（可粘贴给助手调整）"
          >
            {copied ? <Check size={13} className="text-green-500" /> : <Copy size={13} />}
            {copied ? '已复制' : '复制对应关系'}
          </button>
        </div>

        <div className="flex-1 overflow-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 sticky top-0 z-10">
              <tr>
                <th className="w-8"></th>
                <th className="text-left px-3 py-2 font-medium text-gray-600">PDF 文件</th>
                <th className="w-20 text-left px-2 py-2 font-medium text-gray-600">类型</th>
                <th className="w-24 text-left px-2 py-2 font-medium text-gray-600">已选</th>
                <th className="w-32 text-left px-2 py-2 font-medium text-gray-600">操作</th>
              </tr>
            </thead>
            <tbody>
              {visibleRows.map(({ file, matches, pickedCount, isCourse }) => {
                const open = !!expanded[file.fullPath];
                return (
                  <Fragment key={file.fullPath}>
                    <tr
                      className="border-t border-gray-100 hover:bg-gray-50 cursor-pointer"
                      onClick={() => setExpanded((p) => ({ ...p, [file.fullPath]: !p[file.fullPath] }))}
                    >
                      <td className="pl-3 py-1.5 text-gray-400">
                        {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                      </td>
                      <td className="px-3 py-1.5">
                        <div className="flex items-center gap-1.5 min-w-0">
                          <FileText size={13} className="text-gray-400 flex-shrink-0" />
                          <span className="truncate text-gray-800" title={file.fullPath}>{file.fileName}</span>
                        </div>
                      </td>
                      <td className="px-2 py-1.5">
                        {isCourse ? (
                          <span className="inline-flex items-center gap-0.5 rounded bg-amber-100 text-amber-700 px-1.5 py-0.5 text-[10px]">
                            <Layers size={10} /> 合集
                          </span>
                        ) : (
                          <span className="rounded bg-blue-100 text-blue-700 px-1.5 py-0.5 text-[10px]">
                            {file.videoLessonNo != null ? `第${file.videoLessonNo}讲` : '讲次'}
                          </span>
                        )}
                      </td>
                      <td className="px-2 py-1.5">
                        <span className={pickedCount > 0 ? 'text-teal-600 font-medium' : 'text-gray-300'}>
                          {pickedCount} / {matches.length}
                        </span>
                      </td>
                      <td className="px-2 py-1.5" onClick={(e) => e.stopPropagation()}>
                        <div className="flex gap-1">
                          <button
                            onClick={() => setRowAll(file.fullPath, matches, true)}
                            className="px-1.5 py-0.5 text-[10px] rounded border border-gray-300 text-gray-600 hover:bg-gray-100"
                          >
                            全选
                          </button>
                          <button
                            onClick={() => setRowAll(file.fullPath, matches, false)}
                            className="px-1.5 py-0.5 text-[10px] rounded border border-gray-300 text-gray-600 hover:bg-gray-100"
                          >
                            清空
                          </button>
                        </div>
                      </td>
                    </tr>
                    {open && (
                      <tr className="border-t border-gray-100 bg-gray-50/60">
                        <td></td>
                        <td colSpan={4} className="px-3 pb-3 pt-1">
                          {matches.length === 0 ? (
                            <div className="text-xs text-gray-400 py-1">该 PDF 所在课程目录下没有找到视频</div>
                          ) : (
                            <div className="space-y-0.5 max-h-64 overflow-auto">
                              {matches.map((m) => {
                                const checked = !!selection[file.fullPath]?.[m.filePath];
                                return (
                                  <label
                                    key={m.filePath}
                                    className={`flex items-center gap-2 px-2 py-1 rounded cursor-pointer text-xs ${
                                      checked ? 'bg-teal-50' : 'hover:bg-gray-100'
                                    }`}
                                  >
                                    <input
                                      type="checkbox"
                                      checked={checked}
                                      onChange={() => toggleVideo(file.fullPath, m.filePath)}
                                      className="w-3.5 h-3.5 accent-teal-600 cursor-pointer flex-shrink-0"
                                    />
                                    <span className={`flex-shrink-0 tabular-nums ${
                                      m.score >= 0.8 ? 'text-green-600' : m.score >= 0.5 ? 'text-amber-600' : 'text-gray-400'
                                    }`} title="匹配置信度">
                                      {m.score.toFixed(2)}
                                    </span>
                                    <span className="truncate text-gray-700" title={m.filePath}>{m.fileName}</span>
                                  </label>
                                );
                              })}
                            </div>
                          )}
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
          {visibleRows.length === 0 && (
            <div className="py-12 text-center text-sm text-gray-400">没有符合条件的 PDF</div>
          )}
        </div>

        <div className="flex items-center justify-between gap-3 px-6 py-3 border-t border-gray-200 bg-gray-50 rounded-b-xl">
          <p className="text-xs text-gray-500">
            取消勾选的不会写入数据库；讲义/合集类默认挂该课程全部视频，可自行精简。
          </p>
          <div className="flex gap-2">
            <button
              onClick={onCancel}
              className="px-4 py-2 rounded-lg text-sm text-gray-600 hover:bg-gray-200 transition"
            >
              返回
            </button>
            <button
              onClick={() => onConfirm(buildItems())}
              className="px-5 py-2 rounded-lg text-sm font-medium text-white bg-primary hover:bg-primaryDark transition"
            >
              确认并开始导入
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
