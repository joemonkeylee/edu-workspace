import { useEffect, useMemo, useRef, useState } from 'react';
import { CheckCircle2, AlertTriangle, XCircle, Plus, X, Clock } from 'lucide-react';
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
  /** 当前预估用时（分钟），教师批改时可调整 */
  estimatedMinutes?: number;
  submitting?: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (payload: GradeResultPayload) => void | Promise<void>;
}

type Result = 'perfect' | 'wrong' | 'issue' | null;

/**
 * 教师点「标记为已批改」时的结论弹框。
 *
 * 三种结论：
 *   全正确 —— 全部正确，学生无需处理
 *   有错误 —— 有错题，状态本身已说明问题，无需额外标签/备注
 *   有问题 —— 其他问题，需勾选具体类型并可写备注
 */
export default function GradeResultDialog({
  open, assignmentTitle, initial, estimatedMinutes = 30, submitting = false, onOpenChange, onSubmit,
}: Props) {
  const [result, setResult] = useState<Result>(null);
  const [issues, setIssues] = useState<string[]>([]);
  const [custom, setCustom] = useState('');
  const [comment, setComment] = useState('');
  const [estMinutes, setEstMinutes] = useState<number>(estimatedMinutes);

  const initialRef = useRef(initial);
  initialRef.current = initial;

  useEffect(() => {
    if (!open) return;
    const prev = initialRef.current;
    const prevResult = (prev?.result === 'perfect' || prev?.result === 'wrong' || prev?.result === 'issue')
      ? prev.result as Result
      : null;
    const prevIssues = Array.isArray(prev?.issues)
      ? prev!.issues.filter((i): i is string => typeof i === 'string' && i.trim().length > 0)
      : [];
    setResult(prevResult);
    setIssues(prevResult === 'issue' ? prevIssues : []);
    setCustom('');
    setComment(prevResult === 'issue' && typeof prev?.comment === 'string' ? prev.comment : '');
    setEstMinutes(estimatedMinutes);
  }, [open, estimatedMinutes]);

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
    return result !== 'issue' || issues.length > 0;
  }, [result, issues, submitting]);

  const handleSubmit = () => {
    if (!result || !canSubmit) return;
    void onSubmit({
      result,
      issues: result === 'issue' ? issues : [],
      comment: result === 'issue' ? comment.trim() : '',
      estimatedMinutes: estMinutes,
    });
  };

  const submitLabel = result === 'issue' ? '确认并标记有问题'
    : result === 'wrong' ? '确认并标记有错误'
    : result === 'perfect' ? '确认批改' : '确认批改';

  const submitClass = result === 'issue' ? 'bg-amber-600 text-white hover:bg-amber-700'
    : result === 'wrong' ? 'bg-red-600 text-white hover:bg-red-700'
    : 'bg-green-600 text-white hover:bg-green-700';

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[85vh] w-full max-w-md flex-col gap-0 overflow-hidden p-0">
        <DialogHeader className="px-6 pb-2 pt-6 text-left">
          <DialogTitle>批改结果</DialogTitle>
          <DialogDescription className="truncate">
            {assignmentTitle ? `「${assignmentTitle}」` : '本次作业'}
            {' '}标记为已批改后笔迹只读，学生会立即看到下面的结论。
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 space-y-4 overflow-y-auto overflow-x-hidden px-6 py-2">
          {/* 预估用时：教师批改时可调整 */}
          <div className="flex items-center gap-2 rounded-lg border border-border bg-muted/30 px-3 py-2">
            <Clock size={15} className="text-muted-foreground" />
            <span className="text-xs font-medium text-foreground">预估用时</span>
            <input
              type="number"
              min={0}
              max={720}
              list="grade-est-presets"
              value={estMinutes}
              onChange={(e) => {
                const v = parseInt(e.target.value, 10);
                setEstMinutes(Number.isFinite(v) && v >= 0 ? Math.min(v, 720) : 0);
              }}
              className="h-7 w-16 rounded-md border border-input bg-background px-2 text-xs text-foreground text-center focus:outline-none focus:ring-1 focus:ring-primary"
            />
            <span className="text-xs text-muted-foreground">分钟</span>
            <datalist id="grade-est-presets">
              {[0, 30, 40, 45, 60, 90, 120].map((m) => <option key={m} value={m} />)}
            </datalist>
          </div>

          <div className="grid grid-cols-3 gap-2">
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
                <CheckCircle2 size={15} /> 全正确
              </span>
              <span className="text-[11px] text-muted-foreground">全部正确</span>
            </button>
            <button
              type="button"
              onClick={() => setResult('wrong')}
              className={cn(
                'flex flex-col items-start gap-1 rounded-lg border p-3 text-left transition',
                result === 'wrong'
                  ? 'border-red-500 bg-red-50 dark:bg-red-500/10'
                  : 'border-border hover:border-red-400/60 hover:bg-muted/50',
              )}
            >
              <span className="flex items-center gap-1.5 text-sm font-medium text-red-600 dark:text-red-400">
                <XCircle size={15} /> 有错误
              </span>
              <span className="text-[11px] text-muted-foreground">有错题</span>
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
              <span className="text-[11px] text-muted-foreground">需订正/补做</span>
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
              <div className="space-y-1.5 pt-1">
                <span className="text-xs font-medium text-foreground">备注（可选）</span>
                <textarea
                  value={comment}
                  onChange={(e) => setComment(e.target.value.slice(0, 500))}
                  rows={3}
                  placeholder="写给学生的一句话，例如：第 3 题再算一遍"
                  className="w-full resize-none rounded-md border border-input bg-background px-2.5 py-2 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                />
              </div>
            </div>
          )}
        </div>

        <DialogFooter className="gap-2 px-6 pb-6 pt-3 sm:justify-end">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={submitting}>
            取消
          </Button>
          <Button
            onClick={handleSubmit}
            disabled={!canSubmit}
            className={submitClass}
          >
            {submitting ? '提交中...' : submitLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
