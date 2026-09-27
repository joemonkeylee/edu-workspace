/**
 * 「最近批改反馈」——把教师给的结论直接铺在学生面前。
 *
 * 与「我的提交」列表的区别：那一栏是按状态管理作业（提交/删除），
 * 这一栏只看已批改的作业，按批改时间倒序，默认只留「有问题」的，
 * 让学生打开首页就知道哪几份要重做，全对的不用再关心。
 */

import { useMemo, useState } from 'react';
import { AlertTriangle, CheckCircle2, ExternalLink } from 'lucide-react';
import { formatAssignmentTitle } from '../utils/assignment';
import {
  gradeBadge, hasIssue, parseGradeIssues, issueChipClass,
} from '../utils/gradeResult';
import type { SubRow } from './admin/SubmissionPane';

/** 首页不希望出现纵向滚动条，反馈列表最多铺 5 行；更全的列表在下面的「我的提交」里翻页 */
const MAX_ROWS = 5;

function formatTime(dateStr: string | null | undefined, fallback: string): string {
  const raw = dateStr || fallback;
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return '';
  const now = new Date();
  if (d.toDateString() === now.toDateString()) {
    return `今天 ${d.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}`;
  }
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  if (d.toDateString() === yesterday.toDateString()) {
    return `昨天 ${d.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}`;
  }
  return `${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')}`;
}

export default function GradeFeedbackPanel({
  rows,
  loading,
  onOpen,
}: {
  /** 书籍作业 + PDF 作业合并后的行 */
  rows: SubRow[];
  loading: boolean;
  onOpen: (row: SubRow) => void;
}) {
  const [onlyIssue, setOnlyIssue] = useState(true);

  const graded = useMemo(
    () => rows.filter((r) => r.status === 'graded'),
    [rows],
  );
  const issues = useMemo(() => graded.filter((r) => hasIssue(r)), [graded]);
  const perfect = graded.length - issues.length;

  // 只显示「有问题」时若一条都没有，就回落到全部批改记录，免得整块看起来像空面板
  const effectiveOnlyIssue = onlyIssue && issues.length > 0;
  const list = useMemo(() => {
    const base = effectiveOnlyIssue ? issues : graded;
    return [...base]
      .sort((a, b) => {
        const ta = new Date(a.gradedAt || a.updatedAt).getTime() || 0;
        const tb = new Date(b.gradedAt || b.updatedAt).getTime() || 0;
        return tb - ta;
      })
      .slice(0, MAX_ROWS);
  }, [graded, issues, effectiveOnlyIssue]);

  if (!loading && graded.length === 0) return null;

  return (
    <section className="overflow-hidden rounded-lg border border-border bg-card shadow-sm">
      <header className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-2.5">
        <h2 className="text-sm font-semibold text-foreground">最近批改反馈</h2>
        {issues.length > 0 && (
          <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[11px] font-medium text-amber-700 dark:bg-amber-500/15 dark:text-amber-300">
            {issues.length} 份有问题
          </span>
        )}
        {perfect > 0 && (
          <span className="rounded bg-green-100 px-1.5 py-0.5 text-[11px] font-medium text-green-700 dark:bg-green-500/15 dark:text-green-300">
            {perfect} 份全对
          </span>
        )}
        <div className="flex-1" />
        <label className="flex cursor-pointer items-center gap-1.5 text-[11px] text-muted-foreground">
          <input
            type="checkbox"
            checked={effectiveOnlyIssue}
            onChange={(e) => setOnlyIssue(e.target.checked)}
            disabled={issues.length === 0}
            className="h-3.5 w-3.5 cursor-pointer accent-amber-500 disabled:opacity-40"
          />
          只看有问题的
        </label>
      </header>

      {loading && rows.length === 0 ? (
        <div className="px-4 py-6 text-center text-xs text-muted-foreground">加载中...</div>
      ) : list.length === 0 ? (
        <div className="px-4 py-6 text-center text-xs text-muted-foreground">
          最近批改的作业全部通过，继续保持 🎉
        </div>
      ) : (
        <div className="divide-y divide-border">
          {list.map((row) => {
            const badge = gradeBadge(row) || { label: '已批改', className: 'bg-muted text-muted-foreground' };
            const issue = hasIssue(row);
            const tags = parseGradeIssues(row.gradeIssues);
            const title = formatAssignmentTitle(row.title) || `作业 #${row.id}`;
            return (
              <div
                key={`${row.kind}-${row.id}`}
                onClick={() => onOpen(row)}
                className="group flex cursor-pointer items-center gap-2.5 px-4 py-2 transition hover:bg-muted"
                title="点击打开这本书并定位到该作业"
              >
                <span className={`flex-shrink-0 ${issue ? 'text-amber-500' : 'text-green-500'}`}>
                  {issue ? <AlertTriangle size={15} /> : <CheckCircle2 size={15} />}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="min-w-0 flex-1 truncate text-xs font-medium text-foreground">{title}</span>
                    <span className={`flex-shrink-0 rounded px-1 py-px text-[10px] ${badge.className}`}>
                      {badge.label}
                    </span>
                    <span className="flex-shrink-0 rounded bg-muted px-1 py-px text-[10px] text-muted-foreground">
                      {row.kind === 'pdf' ? 'PDF' : '书籍'}
                    </span>
                  </div>
                  <div className="mt-0.5 truncate text-[11px] text-muted-foreground">
                    {row.bookTitle}
                    {row.bookSubject ? ` · ${row.bookSubject}` : ''}
                    {' · '}
                    {formatTime(row.gradedAt, row.updatedAt)}
                  </div>
                  {(tags.length > 0 || row.gradeComment) && (
                    <div className="mt-1 flex flex-wrap items-center gap-1">
                      {tags.map((tag) => (
                        <span key={tag} className={`rounded px-1.5 py-0.5 text-[11px] font-medium ${issueChipClass(tag)}`}>{tag}</span>
                      ))}
                      {row.gradeComment && (
                        <span className="rounded bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground">备注：{row.gradeComment}</span>
                      )}
                    </div>
                  )}
                </div>
                <ExternalLink size={13} className="flex-shrink-0 text-transparent transition group-hover:text-muted-foreground" />
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
