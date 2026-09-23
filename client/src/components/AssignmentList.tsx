import { useState, useEffect } from 'react';
import { FileText, Trash2, Clock, Layers, CheckCircle, Send } from 'lucide-react';
import { getAssignments, deleteAssignment, updateAssignment, type Assignment } from '../api/client';
import { toast } from 'sonner';
import { formatAssignmentTitle } from '../utils/assignment';
import { useConfirm } from './ConfirmDialog';

export interface AssignmentListProps {
  bookId: number;
  onSelect: (assignment: Assignment) => void;
  selectedId: number | null;
  onRefresh?: number;
  onCountChange?: (count: number) => void;
}

export default function AssignmentList({ bookId, onSelect, selectedId, onRefresh, onCountChange }: AssignmentListProps) {
  const confirm = useConfirm();
  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [loading, setLoading] = useState(true);

  const load = () => {
    setLoading(true);
    getAssignments(bookId, { pageSize: 200 }).then(({ data }) => {
      setAssignments(data);
      onCountChange?.(data.length);
    }).finally(() => setLoading(false));
  };

  useEffect(() => {
    load();
  }, [bookId, onRefresh]);

  const handleDelete = async (e: React.MouseEvent, a: Assignment) => {
    e.stopPropagation();
    if (a.status !== 'draft' && a.status !== 'returned') return;
    const title = formatAssignmentTitle(a.title) || `作业 #${a.id}`;
    const confirmed = await confirm({
      title: '确认删除',
      message: `确认删除作业「${title}」吗？此操作不可撤销。`,
      confirmText: '确认删除',
      confirmClass: 'bg-red-600 text-white hover:bg-red-700',
    });
    if (!confirmed) return;
    try {
      await deleteAssignment(a.id);
      toast.success('作业已删除');
      load();
    } catch (err: any) {
      toast.error('删除失败: ' + (err?.message || ''));
    }
  };

  const handleSubmit = async (e: React.MouseEvent, a: Assignment) => {
    e.stopPropagation();
    if (a.status !== 'draft' && a.status !== 'returned') return;
    const title = formatAssignmentTitle(a.title) || `作业 #${a.id}`;
    const confirmed = await confirm({
      title: '确认提交',
      message: `确认提交作业「${title}」吗？\n提交后作业将变为只读，无法再修改或删除。`,
      confirmText: '确认提交',
      confirmClass: 'bg-blue-600 text-white hover:bg-blue-700',
    });
    if (!confirmed) return;
    try {
      await updateAssignment(a.id, { status: 'submitted' });
      toast.success('作业已提交');
      load();
    } catch (err: any) {
      toast.error('提交失败: ' + (err?.message || ''));
    }
  };

  const formatTime = (dateStr: string) => {
    const d = new Date(dateStr);
    const now = new Date();
    const sameDay = d.toDateString() === now.toDateString();
    if (sameDay) return `今天 ${d.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}`;
    return `${d.getMonth() + 1}/${d.getDate()} ${d.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}`;
  };

  if (loading) {
    return <div className="p-4 text-center text-muted-foreground text-sm">加载中...</div>;
  }

  if (assignments.length === 0) {
    return <div className="p-4 text-center text-muted-foreground text-sm">暂无作业</div>;
  }

  return (
    <div className="flex flex-col">
      <div className="flex-1 overflow-auto">
        {assignments.map((a) => {
          const isDraft = a.status === 'draft';
          const isReturned = a.status === 'returned';
          const isSubmitted = a.status === 'submitted';
          const isGraded = a.status === 'graded';
          const canEdit = isDraft || isReturned;
          return (
          <button
            key={a.id}
            onClick={() => onSelect(a)}
            className={`w-full flex items-start gap-2 px-3 py-2.5 text-left border-b border-border transition ${
              selectedId === a.id ? 'bg-primary/10' : 'hover:bg-muted'
            }`}
          >
            <FileText size={16} className={`mt-0.5 flex-shrink-0 ${isGraded ? 'text-green-500' : isSubmitted ? 'text-blue-500' : isReturned ? 'text-amber-500' : 'text-muted-foreground'}`} />
            <div className="flex-1 min-w-0">
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm font-medium text-foreground truncate">{formatAssignmentTitle(a.title) || `作业 #${a.id}`}</span>
                <span className={`flex-shrink-0 inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[10px] font-medium ${
                  isGraded ? 'bg-green-100 text-green-600 dark:bg-green-500/15 dark:text-green-400'
                    : isSubmitted ? 'bg-blue-100 text-blue-600 dark:bg-blue-500/15 dark:text-blue-400'
                    : isReturned ? 'bg-amber-100 text-amber-600 dark:bg-amber-500/15 dark:text-amber-400'
                    : 'bg-muted text-muted-foreground'
                }`}>
                  {isGraded ? <CheckCircle size={9} /> : null}
                  {isGraded ? '已批改' : isSubmitted ? '已提交' : isReturned ? '已打回' : '待提交'}
                </span>
              </div>
              <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground mt-0.5">
                <div className="flex items-center gap-2 min-w-0">
                  <span className="flex items-center gap-0.5 flex-shrink-0">
                    <Clock size={10} />
                    {formatTime(a.createdAt)}
                  </span>
                  {a.pages && a.pages.length > 0 && (
                    <span className="flex items-center gap-0.5 truncate">
                      <Layers size={10} />
                      第 {a.pages.join('、')} 页
                    </span>
                  )}
                </div>
                {canEdit ? (
                  <div className="flex-shrink-0 flex items-center gap-0.5">
                    <span
                      onClick={(e) => handleSubmit(e, a)}
                      title="提交作业"
                      className="p-1 rounded transition text-muted-foreground/60 hover:text-primary hover:bg-primary/10 cursor-pointer"
                    >
                      <Send size={14} />
                    </span>
                    <span
                      onClick={(e) => handleDelete(e, a)}
                      title="删除作业"
                      className="p-1 rounded transition text-muted-foreground/60 hover:text-red-500 hover:bg-red-500/10 cursor-pointer"
                    >
                      <Trash2 size={14} />
                    </span>
                  </div>
                ) : (
                  <span className="flex-shrink-0 p-1 text-muted-foreground/40">
                    <Trash2 size={14} />
                  </span>
                )}
              </div>
            </div>
          </button>
          );
        })}
      </div>
    </div>
  );
}
