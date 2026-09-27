import { useState, useEffect } from 'react';
import { FileText, Trash2, Clock, Layers, CheckCircle, Send } from 'lucide-react';
import { getAssignments, deleteAssignment, updateAssignment, type Assignment } from '../api/client';
import { toast } from 'sonner';
import { formatAssignmentTitle, formatDuration, actualMinutes } from '../utils/assignment';
import { useConfirm } from './ConfirmDialog';
import {
  gradeBadge, hasIssue, parseGradeIssues, issueChipClass,
} from '../utils/gradeResult';

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
  // 已批改的作业里，学生只想看要处理的那几份
  const [onlyIssues, setOnlyIssues] = useState(false);

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

  const issueCount = assignments.filter((a) => hasIssue(a)).length;
  const hasGraded = assignments.some((a) => a.status === 'graded');
  const visible = onlyIssues ? assignments.filter((a) => hasIssue(a)) : assignments;

  if (loading) {
    return <div className="p-4 text-center text-muted-foreground text-sm">加载中...</div>;
  }

  if (assignments.length === 0) {
    return <div className="p-4 text-center text-muted-foreground text-sm">暂无作业</div>;
  }

  return (
    <div className="flex flex-col">
      {hasGraded && (
        <div className="flex items-center justify-between gap-2 border-b border-border px-3 py-1.5">
          <label className="flex cursor-pointer items-center gap-1.5 text-[11px] text-muted-foreground">
            <input
              type="checkbox"
              checked={onlyIssues}
              onChange={(e) => setOnlyIssues(e.target.checked)}
              className="h-3 w-3 accent-amber-500"
            />
            只看有问题的
          </label>
          {issueCount > 0 && (
            <span className="text-[11px] text-amber-600 dark:text-amber-400">{issueCount} 份待处理</span>
          )}
        </div>
      )}
      <div className="flex-1 overflow-auto">
        {visible.map((a) => {
          const isDraft = a.status === 'draft';
          const isReturned = a.status === 'returned';
          const isSubmitted = a.status === 'submitted';
          const canEdit = isDraft || isReturned;
          const badge = gradeBadge(a);
          const issues = parseGradeIssues(a.gradeIssues);
          return (
          <button
            key={a.id}
            onClick={() => onSelect(a)}
            className={`w-full flex items-start gap-2 px-3 py-2.5 text-left border-b border-border transition ${
              selectedId === a.id ? 'bg-primary/10' : 'hover:bg-muted'
            }`}
          >
            <FileText size={16} className={`mt-0.5 flex-shrink-0 ${badge ? (a.gradeResult === 'issue' ? 'text-amber-500' : a.gradeResult === 'wrong' ? 'text-red-500' : 'text-green-500') : isSubmitted ? 'text-blue-500' : isReturned ? 'text-amber-500' : 'text-muted-foreground'}`} />
            <div className="flex-1 min-w-0">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex min-w-0 flex-wrap items-center gap-1.5">
                  <span className="min-w-0 flex-1 truncate text-sm font-medium text-foreground">{formatAssignmentTitle(a.title) || `作业 #${a.id}`}</span>
                  <span className={`flex-shrink-0 inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[10px] font-medium ${
                    badge ? badge.className
                      : isSubmitted ? 'bg-blue-100 text-blue-600 dark:bg-blue-500/15 dark:text-blue-400'
                      : isReturned ? 'bg-amber-100 text-amber-600 dark:bg-amber-500/15 dark:text-amber-400'
                      : 'bg-muted text-muted-foreground'
                  }`}>
                    {badge ? <CheckCircle size={9} /> : null}
                    {badge ? badge.label : isSubmitted ? '已提交' : isReturned ? '已打回' : '待提交'}
                  </span>
                  {a.gradeResult === 'issue' && issues.map((tag) => (
                    <span key={tag} className={`flex-shrink-0 rounded px-1.5 py-0.5 text-[11px] font-medium ${issueChipClass(tag)}`}>{tag}</span>
                  ))}
                </div>
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
                  {(() => {
                    const am = actualMinutes(a);
                    return (
                      <span className="flex items-center gap-0.5 truncate text-[11px]">
                        预估 {formatDuration(a.estimatedMinutes ?? 30)}
                        {am != null && <span className="text-blue-600 dark:text-blue-400"> · 用时 {formatDuration(am)}</span>}
                      </span>
                    );
                  })()}
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
              {a.gradeResult === 'issue' && a.gradeComment && (
                <div className="mt-1 flex flex-wrap items-center gap-1">
                  <span className="rounded bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground">备注：{a.gradeComment}</span>
                </div>
              )}
            </div>
          </button>
          );
        })}
        {visible.length === 0 && (
          <div className="px-3 py-4 text-center text-[11px] text-muted-foreground">
            没有需要处理的作业
          </div>
        )}
      </div>
    </div>
  );
}
