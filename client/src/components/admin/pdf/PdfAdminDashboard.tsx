import { Link } from 'react-router-dom';
import { BookOpen, Highlighter, AlertCircle, ClipboardList, Scan, FileText } from 'lucide-react';

const CARDS = [
  { to: '/admin/pdf/import', icon: Scan, label: 'PDF 导入', desc: '扫描目录批量入库 / 从旧库播种', color: 'text-primary' },
  { to: '/admin/pdf/books', icon: BookOpen, label: 'PDF 书籍', desc: '管理 pdf_book 元数据、软删除恢复', color: 'text-emerald-600 dark:text-emerald-400' },
  { to: '/admin/pdf/annotations', icon: Highlighter, label: 'PDF 批注', desc: '跨书查看 / 删除批注', color: 'text-violet-600 dark:text-violet-400' },
  { to: '/admin/pdf/mistakes', icon: AlertCircle, label: 'PDF 错题', desc: '错题裁图管理、复习状态流转', color: 'text-amber-600 dark:text-amber-400' },
  { to: '/admin/pdf/assignments', icon: ClipboardList, label: 'PDF 作业', desc: '作业列表、批改跳转、批量删除', color: 'text-sky-600 dark:text-sky-400' },
];

export default function PdfAdminDashboard() {
  return (
    <div className="p-6">
      <div className="mb-6">
        <h1 className="text-xl font-semibold text-foreground flex items-center gap-2">
          <FileText size={22} className="text-primary" />
          PDF 原生管理
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          与图片版（PDF → JPG）完全并行的一套后台，数据全部来自 pdf_* 表，互不影响。
        </p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {CARDS.map((card) => {
          const Icon = card.icon;
          return (
            <Link
              key={card.to}
              to={card.to}
              className="block rounded-lg border border-border bg-card p-5 transition hover:shadow-md hover:border-primary/40"
            >
              <div className="flex items-center gap-3">
                <div className={`flex h-10 w-10 items-center justify-center rounded-lg bg-muted ${card.color}`}>
                  <Icon size={20} />
                </div>
                <div>
                  <h3 className="font-medium text-foreground">{card.label}</h3>
                  <p className="text-xs text-muted-foreground mt-0.5">{card.desc}</p>
                </div>
              </div>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
