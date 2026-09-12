import { useEffect, useState, useRef, useCallback } from 'react';
import { Database, Download, Upload, Plus, RotateCcw, Trash2, FileText, FileArchive, Loader2, Plug, Check, X, Save, Star } from 'lucide-react';
import { toast } from 'sonner';
import {
  listDbBackups,
  createDbBackup,
  uploadDbBackup,
  downloadDbBackup,
  deleteDbBackup,
  restoreDbBackup,
  listDbConnections,
  saveDbConnections,
  testDbConnection,
  type DbBackupMeta,
  type DbConnection,
  type ConnectionConfig,
} from '../../api/client';
import { useConfirm } from '../ConfirmDialog';

type Tab = 'backups' | 'connections';

export default function DbBackup() {
  const confirm = useConfirm();
  const [tab, setTab] = useState<Tab>('backups');
  const [backups, setBackups] = useState<DbBackupMeta[]>([]);
  const [config, setConfig] = useState<ConnectionConfig>({ connections: [], defaultConnectionId: null });
  const [loading, setLoading] = useState(false);
  const [creating, setCreating] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadPct, setUploadPct] = useState(0);
  const [format, setFormat] = useState<'gzip' | 'sql'>('gzip');
  const [sourceConnId, setSourceConnId] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const loadBackups = useCallback(async () => {
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

  const loadConfig = useCallback(async () => {
    try {
      const data = await listDbConnections();
      setConfig(data);
      // Pick default or first as source if not set yet
      setSourceConnId((prev) => prev ?? data.defaultConnectionId ?? data.connections[0]?.id ?? null);
    } catch (err: any) {
      toast.error(err?.message || '加载连接配置失败');
    }
  }, []);

  useEffect(() => { loadBackups(); loadConfig(); }, [loadBackups, loadConfig]);

  // ── Backup actions ────────────────────────────────────────────

  const handleCreate = async () => {
    setCreating(true);
    const tid = toast.loading(`正在创建备份 (${format === 'gzip' ? 'gzip 压缩' : 'SQL'})…`);
    try {
      const meta = await createDbBackup(format === 'gzip', sourceConnId);
      toast.success(`备份已创建:${meta.filename}`, { id: tid });
      await loadBackups();
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
      await loadBackups();
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
    // Build target connection options
    const targetOpts = config.connections.length > 0
      ? config.connections
      : [{ id: 'env', name: '默认连接(DATABASE_URL)' }];

    // If only one option, skip selection; else ask user via a second confirm-style prompt
    // Simpler: confirm with default target = source; if user wants different, change source first.
    // For multi-target restore we use a small inline prompt below via confirm with options text.
    const targetId = sourceConnId ?? config.defaultConnectionId ?? targetOpts[0]?.id;
    const targetName = targetOpts.find((c) => c.id === targetId)?.name || '默认连接';
    const ok = await confirm({
      title: '还原数据库',
      message: `将用 "${filename}" 覆盖目标连接「${targetName}」的数据库,系统会先自动备份该连接的当前数据。确定继续?`,
      confirmText: '确认还原',
      confirmClass: 'bg-blue-600 hover:bg-blue-700',
    });
    if (!ok) return;
    setBusy(filename);
    const tid = toast.loading('正在还原(已自动备份当前数据)…');
    try {
      const result = await restoreDbBackup(filename, targetId);
      toast.success(`还原完成${result.preRestoreFile ? `,原数据已备份为 ${result.preRestoreFile}` : ''}`, { id: tid });
      await loadBackups();
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
      await loadBackups();
    } catch (err: any) {
      toast.error(err?.message || '删除失败');
    } finally {
      setBusy(null);
    }
  };

  // ── Connection form state ─────────────────────────────────────

  const [editingConn, setEditingConn] = useState<DbConnection | null>(null);
  const [testing, setTesting] = useState(false);
  const [savingConn, setSavingConn] = useState(false);

  const startNewConn = () => {
    setEditingConn({
      id: `conn-${Date.now()}`,
      name: '',
      host: '',
      port: '3306',
      user: 'root',
      password: '',
      database: '',
    });
  };

  const handleTestConn = async () => {
    if (!editingConn) return;
    setTesting(true);
    const tid = toast.loading('正在测试连接…');
    try {
      const result = await testDbConnection(editingConn);
      if (result.ok) {
        toast.success(`连接成功 · MySQL ${result.version || ''}`, { id: tid });
      } else {
        toast.error(result.error || '连接失败', { id: tid });
      }
    } catch (err: any) {
      toast.error(err?.message || '测试失败', { id: tid });
    } finally {
      setTesting(false);
    }
  };

  const handleSaveConn = async () => {
    if (!editingConn) return;
    if (!editingConn.name || !editingConn.host || !editingConn.user || !editingConn.database) {
      toast.error('名称、Host、用户、数据库为必填');
      return;
    }
    setSavingConn(true);
    try {
      const existing = config.connections.find((c) => c.id === editingConn.id);
      // If password is masked sentinel, keep existing
      let password = editingConn.password;
      if (password === '••••••' && existing) password = existing.password;
      const next: ConnectionConfig = {
        connections: existing
          ? config.connections.map((c) => (c.id === editingConn.id ? { ...editingConn, password } : c))
          : [...config.connections, { ...editingConn, password }],
        defaultConnectionId: config.defaultConnectionId ?? editingConn.id,
      };
      await saveDbConnections(next);
      toast.success('已保存');
      setEditingConn(null);
      await loadConfig();
    } catch (err: any) {
      toast.error(err?.message || '保存失败');
    } finally {
      setSavingConn(false);
    }
  };

  const handleDeleteConn = async (id: string) => {
    const c = config.connections.find((x) => x.id === id);
    const ok = await confirm({
      title: '删除连接',
      message: `确定删除连接「${c?.name || id}」?仅删除配置,不影响数据库。`,
      confirmText: '确认删除',
      confirmClass: 'bg-red-600 hover:bg-red-700',
    });
    if (!ok) return;
    const next: ConnectionConfig = {
      connections: config.connections.filter((c) => c.id !== id),
      defaultConnectionId: config.defaultConnectionId === id ? null : config.defaultConnectionId,
    };
    try {
      await saveDbConnections(next);
      toast.success('已删除');
      await loadConfig();
    } catch (err: any) {
      toast.error(err?.message || '删除失败');
    }
  };

  const handleSetDefault = async (id: string) => {
    const next: ConnectionConfig = { ...config, defaultConnectionId: id };
    try {
      await saveDbConnections(next);
      toast.success('已设为默认');
      await loadConfig();
    } catch (err: any) {
      toast.error(err?.message || '设置失败');
    }
  };

  // ── Helpers ───────────────────────────────────────────────────

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

  const sourceOptions = config.connections.length > 0
    ? config.connections
    : [{ id: 'env', name: '默认连接(DATABASE_URL)' }];

  return (
    <div className="p-6">
      <div className="bg-white rounded-lg shadow">
        {/* Tab header */}
        <div className="flex items-center gap-1 px-6 pt-4 border-b border-gray-200">
          <TabButton active={tab === 'backups'} onClick={() => setTab('backups')} icon={Database} label="备份列表" />
          <TabButton active={tab === 'connections'} onClick={() => setTab('connections')} icon={Plug} label="连接管理" />
        </div>

        {tab === 'backups' && (
          <>
            {/* Action bar */}
            <div className="flex flex-wrap items-center justify-between gap-3 px-6 py-4 border-b border-gray-200">
              <div className="flex items-center gap-2">
                <span className="text-sm text-gray-500">源连接:</span>
                <select
                  value={sourceConnId ?? ''}
                  onChange={(e) => setSourceConnId(e.target.value || null)}
                  className="border border-gray-300 rounded-lg px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary disabled:opacity-50"
                  disabled={creating || uploading}
                >
                  {sourceOptions.map((c) => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                </select>
              </div>
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
                            <button onClick={() => handleDownload(b.filename)} disabled={!!busy} className="p-1.5 rounded text-gray-500 hover:bg-gray-100 hover:text-primary disabled:opacity-50" title="下载">
                              <Download size={16} />
                            </button>
                            <button onClick={() => handleRestore(b.filename)} disabled={!!busy} className="p-1.5 rounded text-gray-500 hover:bg-blue-50 hover:text-blue-600 disabled:opacity-50" title="还原(目标=当前选中的源连接)">
                              <RotateCcw size={16} />
                            </button>
                            <button onClick={() => handleDelete(b.filename)} disabled={!!busy} className="p-1.5 rounded text-gray-500 hover:bg-red-50 hover:text-red-600 disabled:opacity-50" title="删除">
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

            <div className="px-6 py-3 border-t border-gray-200 text-sm text-gray-500">
              共 {backups.length} 条{uploading ? ` · 上传中 ${uploadPct}%` : ''}{sourceConnId ? ` · 目标连接:${sourceOptions.find((c) => c.id === sourceConnId)?.name || ''}` : ''}
            </div>
          </>
        )}

        {tab === 'connections' && (
          <div className="p-6">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h3 className="text-sm font-semibold text-gray-800">MySQL 连接配置</h3>
                <p className="text-xs text-gray-500 mt-0.5">管理可备份/还原的 MySQL 实例。可从 A 库备份、还原到 B 库。</p>
              </div>
              <button onClick={startNewConn} className="flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-sm text-white hover:bg-primaryDark">
                <Plus size={15} /> 新增连接
              </button>
            </div>

            {config.hasEnvFallback && config.connections.length === 0 && (
              <div className="mb-4 p-3 rounded-lg bg-amber-50 border border-amber-200 text-sm text-amber-700">
                当前未添加任何连接,备份/还原将使用 <code className="text-amber-800">DATABASE_URL</code> 环境变量作为默认连接。建议添加显式连接配置以便管理多个 MySQL 实例。
              </div>
            )}

            {/* Connection list */}
            <div className="space-y-2">
              {config.connections.length === 0 && !config.hasEnvFallback && !editingConn && (
                <div className="text-center py-12 text-gray-400">
                  <Plug size={32} className="mx-auto mb-2 text-gray-300" />
                  暂无连接,点击「新增连接」添加
                </div>
              )}
              {config.connections.map((c) => (
                <div key={c.id} className="flex items-center justify-between p-3 rounded-lg border border-gray-200 hover:border-gray-300">
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="flex-shrink-0 w-8 h-8 rounded-full bg-blue-50 text-blue-600 flex items-center justify-center">
                      <Database size={16} />
                    </div>
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium text-gray-800">{c.name}</span>
                        {config.defaultConnectionId === c.id && (
                          <span className="text-xs px-1.5 py-0.5 rounded bg-primary/10 text-primary">默认</span>
                        )}
                      </div>
                      <div className="text-xs text-gray-500 truncate">{c.user}@{c.host}:{c.port}/{c.database}</div>
                    </div>
                  </div>
                  <div className="flex items-center gap-1">
                    {config.defaultConnectionId !== c.id && (
                      <button onClick={() => handleSetDefault(c.id)} className="p-1.5 rounded text-gray-400 hover:bg-amber-50 hover:text-amber-600" title="设为默认">
                        <Star size={16} />
                      </button>
                    )}
                    <button onClick={() => setEditingConn({ ...c, password: c.password ? '••••••' : '' })} className="p-1.5 rounded text-gray-500 hover:bg-gray-100 hover:text-primary" title="编辑">
                      <Plus size={16} className="rotate-45" />
                    </button>
                    <button onClick={() => handleDeleteConn(c.id)} className="p-1.5 rounded text-gray-500 hover:bg-red-50 hover:text-red-600" title="删除">
                      <Trash2 size={16} />
                    </button>
                  </div>
                </div>
              ))}
            </div>

            {/* Editor form */}
            {editingConn && (
              <div className="mt-4 p-4 rounded-lg border border-gray-200 bg-gray-50">
                <div className="flex items-center justify-between mb-3">
                  <h4 className="text-sm font-semibold text-gray-700">{config.connections.find((c) => c.id === editingConn.id) ? '编辑连接' : '新增连接'}</h4>
                  <button onClick={() => setEditingConn(null)} className="text-gray-400 hover:text-gray-600"><X size={18} /></button>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <Field label="名称 *" value={editingConn.name} onChange={(v) => setEditingConn({ ...editingConn, name: v })} placeholder="如:生产库" />
                  <Field label="数据库 *" value={editingConn.database} onChange={(v) => setEditingConn({ ...editingConn, database: v })} placeholder="edu_workspace" />
                  <Field label="Host *" value={editingConn.host} onChange={(v) => setEditingConn({ ...editingConn, host: v })} placeholder="192.168.1.10" />
                  <Field label="端口" value={editingConn.port} onChange={(v) => setEditingConn({ ...editingConn, port: v })} placeholder="3306" />
                  <Field label="用户 *" value={editingConn.user} onChange={(v) => setEditingConn({ ...editingConn, user: v })} placeholder="root" />
                  <Field label="密码" type="password" value={editingConn.password} onChange={(v) => setEditingConn({ ...editingConn, password: v })} placeholder="留空显示为 •••• 表示不修改" />
                </div>
                <div className="flex items-center gap-2 mt-4">
                  <button onClick={handleTestConn} disabled={testing} className="flex items-center gap-1.5 rounded-lg border border-gray-300 px-3 py-1.5 text-sm text-gray-700 hover:border-primary hover:text-primary disabled:opacity-50">
                    {testing ? <Loader2 size={15} className="animate-spin" /> : <Plug size={15} />} 测试连接
                  </button>
                  <button onClick={handleSaveConn} disabled={savingConn} className="flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-sm text-white hover:bg-primaryDark disabled:opacity-50">
                    {savingConn ? <Loader2 size={15} className="animate-spin" /> : <Save size={15} />} 保存
                  </button>
                </div>
              </div>
            )}

            <div className="mt-6 p-3 rounded-lg bg-blue-50 border border-blue-100 text-xs text-blue-700">
              <p className="font-medium mb-1">使用说明</p>
              <ul className="list-disc list-inside space-y-0.5">
                <li>「备份列表」页顶部选择源连接 → 创建备份,文件存到 API 所在机器</li>
                <li>下载备份 → 上传到另一台机器 → 在那台选目标连接 → 点还原,数据进入目标 MySQL</li>
                <li>还原前系统会自动先备份目标连接的当前数据(文件名 pre-restore-*)</li>
                <li>密码明文存储,能进 admin 后台的人都能看到,请按需管控访问</li>
              </ul>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function TabButton({ active, onClick, icon: Icon, label }: { active: boolean; onClick: () => void; icon: any; label: string }) {
  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-1.5 px-4 py-2 text-sm font-medium border-b-2 transition ${
        active ? 'border-primary text-primary' : 'border-transparent text-gray-500 hover:text-gray-700'
      }`}
    >
      <Icon size={16} /> {label}
    </button>
  );
}

function Field({ label, value, onChange, type = 'text', placeholder }: { label: string; value: string; onChange: (v: string) => void; type?: string; placeholder?: string }) {
  return (
    <div>
      <label className="block text-xs font-medium text-gray-600 mb-1">{label}</label>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full px-3 py-1.5 border border-gray-300 rounded text-sm focus:outline-none focus:ring-2 focus:ring-primary"
      />
    </div>
  );
}
