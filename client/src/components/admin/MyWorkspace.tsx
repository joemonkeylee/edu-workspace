import { useCallback, useEffect, useState } from 'react';
import { getMyAssignments, updateAssignment, deleteAssignment } from '../../api/client';
import * as pdfApi from '../../pdf/api/pdfClient';
import { toast } from 'sonner';
import { useConfirm } from '../ConfirmDialog';
import { formatAssignmentTitle } from '../../utils/assignment';
import { useAuthStore } from '../../store/authStore';
import SubmissionPane, {
  type SubRow,
  type SubCounts,
  type SubBookOption,
  type SubKind,
} from './SubmissionPane';

const EMPTY_COUNTS: SubCounts = { all: 0, draft: 0, submitted: 0, graded: 0, returned: 0 };

type BookRow = {
  id: number;
  bookId: number;
  title: string;
  status: string;
  updatedAt: string;
  pages?: number[] | null;
  book: {
    id: number;
    title: string;
    subject: string;
    category: string;
    coverPage: number;
    totalPages: number;
    storagePath: string;
    availableDpis: number[];
  } | null;
};

/**
 * admin 概览页的工作台，纵向两块：
 * 1. 「学习概览」4 个指标平铺一行 —— 书籍作业与 PDF 作业合并计数。
 * 2. 「我的提交」左右分栏：左栏书籍作业（图片模式），右栏 PDF 作业（PDF 原生模式）。
 *    两侧数据来自两张互不相干的表，按 kind 区分，点击分别跳 /book/:id 与 /pdf/book/:id。
 * english 打卡墙等后续模块插在两块之间或继续往下追加新行即可。
 */
export default function MyWorkspace() {
  const confirm = useConfirm();
  const { user, authEnabled } = useAuthStore();

  const [bookRows, setBookRows] = useState<SubRow[]>([]);
  const [bookCounts, setBookCounts] = useState<SubCounts>(EMPTY_COUNTS);
  const [bookOptions, setBookOptions] = useState<SubBookOption[]>([]);
  const [bookLoading, setBookLoading] = useState(true);
  const [bookSelected, setBookSelected] = useState<string>('');

  const [pdfRows, setPdfRows] = useState<SubRow[]>([]);
  const [pdfCounts, setPdfCounts] = useState<SubCounts>(EMPTY_COUNTS);
  const [pdfOptions, setPdfOptions] = useState<SubBookOption[]>([]);
  const [pdfLoading, setPdfLoading] = useState(true);
  const [pdfSelected, setPdfSelected] = useState<string>('');

  // 两库自增 id 会撞号，所以忙碌标记带上 kind
  const [busyKey, setBusyKey] = useState<string | null>(null);

  const toSubRow = (kind: SubKind, r: BookRow | pdfApi.MyPdfAssignment): SubRow => ({
    kind,
    id: r.id,
    bookId: r.bookId,
    title: r.title,
    status: r.status,
    updatedAt: r.updatedAt,
    pages: (r as any).pages ?? null,
    bookTitle: r.book?.title || `书籍 #${r.bookId}`,
    bookSubject: r.book?.subject || '',
    book: r.book,
  });

  const loadBooks = useCallback(async () => {
    setBookLoading(true);
    try {
      const res = await getMyAssignments(80, bookSelected ? Number(bookSelected) : undefined);
      setBookRows(res.data.map((r) => toSubRow('book', r as BookRow)));
      setBookCounts(res.counts || EMPTY_COUNTS);
      setBookOptions(res.books || []);
    } catch (e: any) {
      toast.error('加载书籍作业失败: ' + (e?.message || ''));
    } finally {
      setBookLoading(false);
    }
  }, [bookSelected]); // eslint-disable-line react-hooks/exhaustive-deps

  const loadPdfs = useCallback(async () => {
    setPdfLoading(true);
    try {
      const res = await pdfApi.getMyPdfAssignments(80, pdfSelected ? Number(pdfSelected) : undefined);
      setPdfRows(res.data.map((r) => toSubRow('pdf', r)));
      setPdfCounts(res.counts || EMPTY_COUNTS);
      setPdfOptions(res.books || []);
    } catch (e: any) {
      toast.error('加载 PDF 作业失败: ' + (e?.message || ''));
    } finally {
      setPdfLoading(false);
    }
  }, [pdfSelected]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { loadBooks(); }, [loadBooks]);
  useEffect(() => { loadPdfs(); }, [loadPdfs]);

  const refreshAll = () => { loadBooks(); loadPdfs(); };

  const totals: SubCounts = {
    all: bookCounts.all + pdfCounts.all,
    draft: bookCounts.draft + pdfCounts.draft,
    submitted: bookCounts.submitted + pdfCounts.submitted,
    graded: bookCounts.graded + pdfCounts.graded,
    returned: bookCounts.returned + pdfCounts.returned,
  };

  /** 按类型跳到对应的阅读器。教师开批改层（grading=1），其余一律只读查看 */
  const open = (row: SubRow) => {
    const canGrade = !authEnabled || Boolean(user?.isAdmin || user?.roles?.includes('teacher'));
    const suffix = canGrade && row.status === 'submitted' ? '&grading=1' : '';
    const base = row.kind === 'pdf' ? `/pdf/book/${row.bookId}` : `/book/${row.bookId}`;
    window.open(`${base}?assignmentId=${row.id}${suffix}`, '_blank');
  };

  const handleSubmit = async (row: SubRow) => {
    if (busyKey) return;
    const title = formatAssignmentTitle(row.title) || `作业 #${row.id}`;
    const confirmed = await confirm({
      title: '确认提交',
      message: `确认提交作业「${title}」吗？\n提交后作业将变为只读，无法再修改或删除。`,
      confirmText: '确认提交',
      confirmClass: 'bg-blue-600 text-white hover:bg-blue-700',
    });
    if (!confirmed) return;
    setBusyKey(`${row.kind}-${row.id}`);
    try {
      if (row.kind === 'pdf') {
        await pdfApi.updateAssignment(row.id, { status: 'submitted' });
      } else {
        await updateAssignment(row.id, { status: 'submitted' });
      }
      toast.success('作业已提交');
      refreshAll();
    } catch (err: any) {
      toast.error('提交失败: ' + (err?.message || ''));
    } finally {
      setBusyKey(null);
    }
  };

  const handleDelete = async (row: SubRow) => {
    if (busyKey) return;
    const title = formatAssignmentTitle(row.title) || `作业 #${row.id}`;
    const confirmed = await confirm({
      title: '确认删除',
      message: `确认删除作业「${title}」吗？此操作不可撤销。`,
      confirmText: '确认删除',
      confirmClass: 'bg-red-600 text-white hover:bg-red-700',
    });
    if (!confirmed) return;
    setBusyKey(`${row.kind}-${row.id}`);
    try {
      if (row.kind === 'pdf') {
        await pdfApi.deleteAssignment(row.id);
      } else {
        await deleteAssignment(row.id);
      }
      toast.success('作业已删除');
      refreshAll();
    } catch (err: any) {
      toast.error('删除失败: ' + (err?.message || ''));
    } finally {
      setBusyKey(null);
    }
  };

  /** 某一行是否正在提交/删除。两库 id 会撞号，所以比对完整的 kind-id */
  const busyIdFor = (rows: SubRow[]) => {
    if (!busyKey) return null;
    const hit = rows.find((r) => `${r.kind}-${r.id}` === busyKey);
    return hit ? hit.id : null;
  };

  return (
    <div className="flex flex-col gap-3">
      {/* ── 学习概览：4 个指标平铺一行（书籍 + PDF 合计）；english 打卡墙等后续模块往中间插 ── */}
      <div className="grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-border bg-border sm:grid-cols-4">
        {[
          { label: '草稿待提交', value: totals.draft, tone: 'text-foreground' },
          { label: '待批改', value: totals.submitted, tone: 'text-blue-600 dark:text-blue-300' },
          { label: '已批改', value: totals.graded, tone: 'text-green-600 dark:text-green-300' },
          { label: '已打回', value: totals.returned, tone: 'text-amber-600 dark:text-amber-300' },
        ].map((s) => (
          <div key={s.label} className="bg-card px-4 py-3">
            <div className={`text-xl font-semibold tabular-nums ${s.tone}`}>{s.value}</div>
            <div className="mt-0.5 text-[11px] text-muted-foreground">{s.label}</div>
          </div>
        ))}
      </div>

      {/* ── 我的提交：左书籍 / 右 PDF 各占一半，窄屏自动上下堆叠 ── */}
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        <SubmissionPane
          kind="book"
          rows={bookRows}
          counts={bookCounts}
          loading={bookLoading}
          books={bookOptions}
          selectedBook={bookSelected}
          onSelectBook={setBookSelected}
          onRefresh={loadBooks}
          onOpen={open}
          onSubmit={handleSubmit}
          onDelete={handleDelete}
          busyId={busyIdFor(bookRows)}
        />
        <SubmissionPane
          kind="pdf"
          rows={pdfRows}
          counts={pdfCounts}
          loading={pdfLoading}
          books={pdfOptions}
          selectedBook={pdfSelected}
          onSelectBook={setPdfSelected}
          onRefresh={loadPdfs}
          onOpen={open}
          onSubmit={handleSubmit}
          onDelete={handleDelete}
          busyId={busyIdFor(pdfRows)}
        />
      </div>
    </div>
  );
}
