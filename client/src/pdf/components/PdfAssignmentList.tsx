import { useEffect, useState } from 'react';
import { FileText, Clock, Layers, Trash2, Send, CheckCircle2 } from 'lucide-react';
import { useConfirm } from '../../components/ConfirmDialog';
import {
  listAssignments, deleteAssignment, updateAssignment,
  type PdfAssignment,
} from '../api/pdfClient';
import { formatAssignmentTitle } from '../../utils/assignment';
import { toast } from 'sonner';

interface Props {
  bookId: number;
  onSelect: (assignment: PdfAssignment) => void;
  selectedId: number | null;
  onRefresh?: number;
  onCountChange?: (count: number) => void;
}

/**
 * PDF 域的作业列表（右侧栏「作业」tab）。
 * 与图片版 AssignmentList 一致，数据源换成 /api/pdf/assignments。
 */
export default function PdfAssignmentList({ bookId, onSelect, selectedId, onRefresh, onCountChange }: Props) {
  const [assignments, setAssignments] = useState<PdfAssignment[]>([]);
  const [loading, setLoading] = useState(true);
  const confirm = useConfirm();

  const load = () => {
    setLoading(true);
    listAssignments(bookId, { pageSize: 200 })
      .then(({ data }) => {
        setAssignments(data);
        onCountChange?.(data.length);
      })
      .catch(() => { /* 列表失败不打扰用户 */ })
      .finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, [bookId, onRefresh]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleDelete = async (a: PdfAssignment) => {
    if (a.status !== 'draft' && a.status !== 'returned') return;
    const ok = await confirm({
      title: '删除作业',
      message: `确定删除「${formatAssignmentTitle(a.title) || `作业 #${a.id}`}」吗？此操作不可撤销。`,
      confirmText: '删除',
      confirmClass: 'bg-red-600 text-white hover:bg-red-700',
    });
    if (!ok) return;
    try {
      await deleteAssignment(a.id);
      toast.success('作业已删除');
      load();
    } catch (e: any) {
      toast.error('删除失败: ' + (e?.message || ''));
    }
  };

  const handleSubmit = async (a: PdfAssignment) => {
    if (a.status !== 'draft' && a.status !== 'returned') return;
    const ok = await confirm({
      title: '提交作业',
      message: `提交「${formatAssignmentTitle(a.title) || `作业 #${a.id}`}」后作业将变为只读，无法再修改或删除。`,
      confirmText: '提交',
      confirmClass: 'bg-blue-600 text-white hover:bg-blue-700',
    });
    if (!ok) return;
    try {
      await updateAssignment(a.id, { status: 'submitted' });
      toast.success('作业已提交');
      load();
    } catch (e: any) {
      toast.error('提交失败: ' + (e?.message || ''));
    }
  };

  if (loading && assignments.length === 0) {
    return <div className="p-4 text-center text-sm text-muted-foreground">加载中...</div>;
  }
  if (assignments.length === 0) {
    return <div className="p-4 text-center text-sm text-muted-foreground">暂无作业</div>;
  }

  return (
    <div className="space-y-2 p-2">
      {assignments.map((a) => {
        const isGraded = a.status === 'graded';
        const isSubmitted = a.status === 'submitted';
        const isReturned = a.status === 'returned';
        return (
          <div
            key={a.id}
            onClick={() => onSelect(a)}
            className={`cursor-pointer rounded-lg border p-2.5 transition ${
              selectedId === a.id
                ? 'border-primary bg-primary/5'
                : 'border-border hover:border-primary/40 hover:bg-muted/50'
            }`}
          >
            <button
              onClick={() => onSelect(a)}
              className="flex w-full items-start gap-2 text-left"
            >
              <FileText
                size={16}
                className={`mt-0.5 flex-shrink-0 ${
                  isGraded ? 'text-green-500'
                    : isSubmitted ? 'text-blue-500'
                      : isReturned ? 'text-amber-500'
                        : 'text-muted-foreground'
                }`}
              />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5">
                  <span className="truncate text-xs font-medium text-foreground">
                    {formatAssignmentTitle(a.title) || `作业 #${a.id}`}
                  </span>
                  <span
                    className={`flex-shrink-0 inline-flex items-center gap-0.5 rounded px-1.5 py-0.5 text-[10px] font-medium ${
                      isGraded ? 'bg-green-100 text-green-600 dark:bg-green-500/15 dark:text-green-400'
                        : isSubmitted ? 'bg-blue-100 text-blue-600 dark:bg-blue-500/15 dark:text-blue-400'
                          : isReturned ? 'bg-amber-100 text-amber-600 dark:bg-amber-500/15 dark:text-amber-400'
                            : 'bg-muted text-muted-foreground'
                    }`}
                  >
                    {isGraded && <CheckCircle2 size={9} />}
                    {isGraded ? '已批改' : isSubmitted ? '已提交' : isReturned ? '已打回' : '待提交'}
                  </span>
                </div>
                <div className="mt-1 flex flex-wrap items-center gap-2 text-[10px] text-muted-foreground">
                  <span className="flex items-center gap-0.5">
                    <Clock size={9} /> {formatTime(a.createdAt)}
                  </span>
                  {Array.isArray(a.pages) && a.pages.length > 0 && (
                    <span className="flex items-center gap-0.5">
                      <Layers size={9} /> 第 {a.pages.join('、')} 页
                    </span>
                  )}
                </div>
              </div>
            </button>

            {(a.status === 'draft' || a.status === 'returned') && (
              <div className="mt-2 flex justify-end gap-1">
                <button
                  onClick={(e) => { e.stopPropagation(); void handleSubmit(a); }}
                  className="flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-500/10"
                >
                  <Send size={10} /> 提交
                </button>
                <button
                  onClick={(e) => { e.stopPropagation(); void handleDelete(a); }}
                  className="flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] text-red-600 hover:bg-red-50 dark:hover:bg-red-500/10"
                >
                  <Trash2 size={10} /> 删除
                </button>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function formatTime(dateStr: string): string {
  try {
    const d = new Date(dateStr);
    const now = new Date();
    const time = d.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
    if (d.toDateString() === now.toDateString()) return `今天 ${time}`;
    return `${d.getMonth() + 1}/${d.getDate()} ${time}`;
  } catch {
    return '';
  }
}
