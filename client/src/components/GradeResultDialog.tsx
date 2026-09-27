import { useEffect, useMemo, useRef, useState } from 'react';
import { CheckCircle2, AlertTriangle, Plus, X } from 'lucide-react';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { GRADE_ISSUE_PRESETS, type GradeResultPayload } from '../utils/gradeResult';
import { cn } from '@/lib/utils';

interface Props {
  open: boolean;
  /** 作业标题，只做展示 */
  assignmentTitle?: string;
  /** 已批改过的作业重新批改时回填上次结论 */
  initial?: { result?: string | null; issues?: unknown; comment?: string | null };
  submitting?: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (payload: GradeResultPayload) => void | Promise<void>;
}

/**
 * 教师点「标记为已批改」时的结论弹框。
 *
 * 只做一件事：把「全对 / 有问题」收敛成结构化结果存下来，学生侧就能
 * 直接筛出「有问题」的作业去处理，不必逐个打开看批注。
 * 常见问题做成预设标签一键勾选，另留自定义输入与备注。
 */
export default function GradeResultDialog({
  open, assignmentTitle, initial, submitting = false, onOpenChange, onSubmit,
}: Props) {
  const [result, setResult] = useState<'perfect' | 'issue' | null>(null);
  const [issues, setIssues] = useState<string[]>([]);
  const [custom, setCustom] = useState('');
  const [comment, setComment] = useState('');

  // 只在「打开」这一刻回填一次。父层（做题全屏层）会因为自动保存频繁重渲染，
  // 若把 initial 直接放进依赖里，教师勾到一半的选项会被反复重置。
  const initialRef = useRef(initial);
  initialRef.current = initial;

  useEffect(() => {
    if (!open) return;
    const prev = initialRef.current;
    const prevResult = prev?.result === 'perfect' || prev?.result === 'issue' ? prev.result : null;
    const prevIssues = Array.isArray(prev?.issues)
      ? prev!.issues.filter((i): i is string => typeof i === 'string' && i.trim().length > 0)
      : [];
    setResult(prevResult);
    setIssues(prevIssues);
    setCustom('');
    setComment(typeof prev?.comment === 'string' ? prev.comment : '');
  }, [open]);

  const toggleIssue = (label: string) => {
    setIssues((current) => (
      current.includes(label) ? current.filter((i) => i !== label) : [...current, label]
    ));
  };

  const addCustomIssue = () => {
    const text = custom.trim();
    if (!text || issues.includes(text)) { setCustom(''); return; }
    setIssues((current) => [...current, text.slice(0, 30)]);
    setCustom('');
  };

  const canSubmit = useMemo(() => {
    if (submitting || !result) return false;
    // 「有问题」必须说清楚问题是什么，否则学生侧拿不到任何可执行的提示
    return result === 'perfect' || issues.length > 0;
  }, [result, issues, submitting]);

  const handleSubmit = () => {
    if (!result || !canSubmit) return;
    void onSubmit({
      result,
      issues: result === 'issue' ? issues : [],
      comment: comment.trim(),
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md gap-4">
        <DialogHeader className="text-left">
          <DialogTitle>批改结果</DialogTitle>
          <DialogDescription className="truncate">
            {assignmentTitle ? `「${assignmentTitle}」` : '本次作业'}
            {' '}标记为已批改后笔迹只读，学生会立即看到下面的结论。
          </DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={() => setResult('perfect')}
            className={cn(
              'flex flex-col items-start gap-1 rounded-lg border p-3 text-left transition',
              result === 'perfect'
                ? 'border-green-500 bg-green-50 dark:bg-green-500/10'
                : 'border-border hover:border-green-400/60 hover:bg-muted/50',
            )}
          >
            <span className="flex items-center gap-1.5 text-sm font-medium text-green-600 dark:text-green-400">
              <CheckCircle2 size={15} /> 全对
            </span>
            <span className="text-[11px] text-muted-foreground">全部正确，学生无需处理</span>
          </button>
          <button
            type="button"
            onClick={() => setResult('issue')}
            className={cn(
              'flex flex-col items-start gap-1 rounded-lg border p-3 text-left transition',
              result === 'issue'
                ? 'border-amber-500 bg-amber-50 dark:bg-amber-500/10'
                : 'border-border hover:border-amber-400/60 hover:bg-muted/50',
            )}
          >
            <span className="flex items-center gap-1.5 text-sm font-medium text-amber-600 dark:text-amber-500">
              <AlertTriangle size={15} /> 有问题
            </span>
            <span className="text-[11px] text-muted-foreground">需要学生订正或补做</span>
          </button>
        </div>

        {result === 'issue' && (
          <div className="space-y-2 rounded-lg border border-border bg-muted/30 p-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-foreground">常见问题（可多选）</span>
              <span className="text-[11px] text-muted-foreground">已选 {issues.length} 项</span>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {GRADE_ISSUE_PRESETS.map((label) => {
                const active = issues.includes(label);
                return (
                  <button
                    key={label}
                    type="button"
                    onClick={() => toggleIssue(label)}
                    className={cn(
                      'rounded-full border px-2.5 py-1 text-[11px] transition',
                      active
                        ? 'border-amber-500 bg-amber-500/15 text-amber-700 dark:text-amber-300'
                        : 'border-border text-muted-foreground hover:border-amber-400/60 hover:text-foreground',
                    )}
                  >
                    {label}
                  </button>
                );
              })}
              {issues
                .filter((i) => !GRADE_ISSUE_PRESETS.includes(i))
                .map((label) => (
                  <span
                    key={label}
                    className="inline-flex items-center gap-1 rounded-full border border-amber-500 bg-amber-500/15 px-2.5 py-1 text-[11px] text-amber-700 dark:text-amber-300"
                  >
                    {label}
                    <button type="button" onClick={() => toggleIssue(label)} title="移除">
                      <X size={10} />
                    </button>
                  </span>
                ))}
            </div>
            <div className="flex items-center gap-1.5">
              <input
                value={custom}
                onChange={(e) => setCustom(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addCustomIssue(); } }}
                placeholder="其他问题，回车添加"
                className="h-7 min-w-0 flex-1 rounded-md border border-input bg-background px-2 text-[11px] text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary"
              />
              <Button
                type="button"
                variant="outline"
                size="icon"
                className="h-7 w-7"
                onClick={addCustomIssue}
                disabled={!custom.trim()}
                title="添加"
              >
                <Plus size={13} />
              </Button>
            </div>
          </div>
        )}

        <div className="space-y-1.5">
          <span className="text-xs font-medium text-foreground">备注（可选）</span>
          <textarea
            value={comment}
            onChange={(e) => setComment(e.target.value.slice(0, 500))}
            rows={2}
            placeholder="写给学生的一句话，例如：第 3 题再算一遍"
            className="w-full resize-none rounded-md border border-input bg-background px-2.5 py-2 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary"
          />
        </div>

        <DialogFooter className="gap-2 sm:justify-end">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={submitting}>
            取消
          </Button>
          <Button
            onClick={handleSubmit}
            disabled={!canSubmit}
            className={cn(
              result === 'issue'
                ? 'bg-amber-600 text-white hover:bg-amber-700'
                : 'bg-green-600 text-white hover:bg-green-700',
            )}
          >
            {submitting ? '提交中...' : result === 'issue' ? '确认并标记有问题' : '确认批改'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
