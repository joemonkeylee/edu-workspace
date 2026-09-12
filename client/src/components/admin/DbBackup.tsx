import { useEffect, useState, useRef, useCallback } from 'react';
import { Database, Download, Upload, Plus, RotateCcw, Trash2, FileText, FileArchive, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import {
  listDbBackups,
  createDbBackup,
  uploadDbBackup,
  downloadDbBackup,
  deleteDbBackup,
  restoreDbBackup,
  type DbBackupMeta,
} from '../../api/client';
import { useConfirm } from '../ConfirmDialog';

export default function DbBackup() {
  const confirm = useConfirm();
  const [backups, setBackups] = useState<DbBackupMeta[]>([]);
  const [loading, setLoading] = useState(false);
  const [creating, setCreating] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadPct, setUploadPct] = useState(0);
  const [format, setFormat] = useState<'gzip' | 'sql'>('gzip');
  const [busy, setBusy] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await listDbBackups();
      setBackups(data);
    } catch (err: any) {
      toast.error(err?.message || '加载备份列表失败');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const handleCreate = async () => {
    setCreating(true);
    const tid = toast.loading(`正在创建备份 (${format === 'gzip' ? 'gzip 压缩' : 'SQL'})…`);
    try {
      const meta = await createDbBackup(format === 'gzip');
      toast.success(`备份已创建:${meta.filename}`, { id: tid });
      await load();
    } catch (err: any) {
      toast.error(err?.message || '创建备份失败', { id: tid });
    } finally {
      setCreating(false);
    }
  };

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setUploading(true);
    setUploadPct(0);
    const tid = toast.loading('正在上传备份…');
    try {
      const meta = await uploadDbBackup(file, (pct) => {
        setUploadPct(pct);
        toast.loading(`正在上传备份… ${pct}%`, { id: tid });
      });
      toast.success(`上传成功:${meta.filename}`, { id: tid });
      await load();
    } catch (err: any) {
      toast.error(err?.message || '上传失败', { id: tid });
    } finally {
      setUploading(false);
    }
  };

  const handleDownload = async (filename: string) => {
    const tid = toast.loading('正在准备下载…');
    try {
      await downloadDbBackup(filename);
      toast.success('下载已开始', { id: tid });
    } catch (err: any) {
      toast.error(err?.message || '下载失败', { id: tid });
    }
  };

  const handleRestore = async (filename: string) => {
    const ok = await confirm({
      title: '还原数据库',
      message: `将用 "${filename}" 覆盖当前数据库,系统会先自动备份当前数据。确定继续?`,
      confirmText: '确认还原',
      confirmClass: 'bg-blue-600 hover:bg-blue-700',
    });
    if (!ok) return;
    setBusy(filename);
    const tid = toast.loading('正在还原(已自动备份当前数据)…');
    try {
      const result = await restoreDbBackup(filename);
      toast.success(`还原完成${result.preRestoreFile ? `,原数据已备份为 ${result.preRestoreFile}` : ''}`, { id: tid });
      await load();
    } catch (err: any) {
      toast.error(err?.message || '还原失败', { id: tid });
    } finally {
      setBusy(null);
    }
  };

  const handleDelete = async (filename: string) => {
    const ok = await confirm({
      title: '删除备份',
      message: `确定删除 "${filename}"?此操作不可撤销。`,
      confirmText: '确认删除',
      confirmClass: 'bg-red-600 hover:bg-red-700',
    });
    if (!ok) return;
    setBusy(filename);
    try {
      await deleteDbBackup(filename);
      toast.success('已删除');
      await load();
    } catch (err: any) {
      toast.error(err?.message || '删除失败');
    } finally {
      setBusy(null);
    }
  };

  const formatSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
  };

  const formatDate = (iso: string) => {
    const d = new Date(iso);
    return d.toLocaleString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' });
  };

  return (
    <div className="p-6">
      <div className="bg-white rounded-lg shadow">
        {/* Header / actions */}
        <div className="flex flex-wrap items-center justify-between gap-3 px-6 py-4 border-b border-gray-200">
          <h2 className="text-base font-semibold text-gray-800">数据库备份</h2>
          <div className="flex items-center gap-2">
            <select
              value={format}
              onChange={(e) => setFormat(e.target.value as 'gzip' | 'sql')}
              className="border border-gray-300 rounded-lg px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary disabled:opacity-50"
              disabled={creating || uploading}
              title="备份格式"
            >
              <option value="gzip">gzip 压缩 (.sql.gz)</option>
              <option value="sql">纯 SQL (.sql)</option>
            </select>
            <button
              onClick={handleCreate}
              disabled={creating || uploading}
              className="flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-sm text-white hover:bg-primaryDark disabled:opacity-50"
            >
              {creating ? <Loader2 size={15} className="animate-spin" /> : <Plus size={15} />} 创建备份
            </button>
            <button
              onClick={() => fileInputRef.current?.click()}
              disabled={creating || uploading}
              className="flex items-center gap-1.5 rounded-lg border border-gray-300 px-3 py-1.5 text-sm text-gray-700 hover:border-primary hover:text-primary disabled:opacity-50"
            >
              {uploading ? <Loader2 size={15} className="animate-spin" /> : <Upload size={15} />} 上传备份
            </button>
            <input ref={fileInputRef} type="file" accept=".sql,.gz" className="hidden" onChange={handleUpload} />
          </div>
        </div>

        {/* Table */}
        <div className="relative overflow-x-auto">
          {loading && (
            <div className="absolute inset-0 z-10 flex items-center justify-center bg-white/60">
              <Loader2 className="animate-spin text-primary" size={28} />
            </div>
          )}
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-gray-500">
              <tr>
                <th className="px-6 py-3 text-left font-medium">文件名</th>
                <th className="px-4 py-3 text-left font-medium">格式</th>
                <th className="px-4 py-3 text-left font-medium">大小</th>
                <th className="px-4 py-3 text-left font-medium">创建时间</th>
                <th className="px-4 py-3 text-right font-medium">操作</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {backups.length === 0 && !loading ? (
                <tr>
                  <td colSpan={5} className="px-6 py-12 text-center text-gray-400">
                    <Database size={32} className="mx-auto mb-2 text-gray-300" />
                    暂无备份,点击「创建备份」生成第一份
                  </td>
                </tr>
              ) : (
                backups.map((b) => (
                  <tr key={b.filename} className="hover:bg-gray-50">
                    <td className="px-6 py-3">
                      <div className="flex items-center gap-2">
                        {b.compressed ? <FileArchive size={16} className="text-gray-400" /> : <FileText size={16} className="text-gray-400" />}
                        <span className="text-gray-800">{b.filename}</span>
                        {b.type === 'pre-restore' && (
                          <span className="text-xs px-1.5 py-0.5 rounded bg-gray-100 text-gray-500">还原前</span>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-gray-600">{b.compressed ? '.sql.gz' : '.sql'}</td>
                    <td className="px-4 py-3 text-gray-600">{formatSize(b.size)}</td>
                    <td className="px-4 py-3 text-gray-600">{formatDate(b.createdAt)}</td>
                    <td className="px-4 py-3 text-right">
                      <div className="flex items-center justify-end gap-1">
                        <button
                          onClick={() => handleDownload(b.filename)}
                          disabled={!!busy}
                          className="p-1.5 rounded text-gray-500 hover:bg-gray-100 hover:text-primary disabled:opacity-50"
                          title="下载"
                        >
                          <Download size={16} />
                        </button>
                        <button
                          onClick={() => handleRestore(b.filename)}
                          disabled={!!busy}
                          className="p-1.5 rounded text-gray-500 hover:bg-blue-50 hover:text-blue-600 disabled:opacity-50"
                          title="还原"
                        >
                          <RotateCcw size={16} />
                        </button>
                        <button
                          onClick={() => handleDelete(b.filename)}
                          disabled={!!busy}
                          className="p-1.5 rounded text-gray-500 hover:bg-red-50 hover:text-red-600 disabled:opacity-50"
                          title="删除"
                        >
                          <Trash2 size={16} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* Footer */}
        <div className="px-6 py-3 border-t border-gray-200 text-sm text-gray-500">
          共 {backups.length} 条{uploading ? ` · 上传中 ${uploadPct}%` : ''}
        </div>
      </div>
    </div>
  );
}
