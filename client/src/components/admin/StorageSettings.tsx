import { useEffect, useState } from 'react';
import { FolderOpen, RefreshCw, Save } from 'lucide-react';
import { getStorageSettings, inspectStorageSettings, openStorageDirectory, updateStorageSettings } from '../../api/client';
import { useConfirm } from '../ConfirmDialog';
import { Button } from "@/components/ui/button";

export default function StorageSettings() {
  const confirm = useConfirm();
  const [path, setPath] = useState('');
  const [matchedBooks, setMatchedBooks] = useState(0);
  const [totalBooks, setTotalBooks] = useState(0);
  const [writable, setWritable] = useState(false);
  const [checking, setChecking] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');

  const load = async () => {
    const data = await getStorageSettings();
    setPath(data.path);
    setMatchedBooks(data.matchedBooks);
    setTotalBooks(data.totalBooks);
    setWritable(data.writable);
  };

  useEffect(() => { load().catch(() => setMessage('读取资源目录配置失败')); }, []);

  const inspect = async () => {
    setChecking(true);
    setMessage('');
    try {
      const data = await inspectStorageSettings(path);
      setPath(data.path);
      setMatchedBooks(data.matchedBooks);
      setTotalBooks(data.totalBooks);
      setWritable(data.writable);
      setMessage(`检测到 ${data.matchedBooks}/${data.totalBooks} 本书的资源；${data.writable ? '目录可写' : '目录不可写或尚不存在'}`);
    } catch (error: any) {
      setMessage(error?.response?.data?.error || '目录检查失败');
    } finally {
      setChecking(false);
    }
  };

  const save = async () => {
    if (!path.trim()) return;
    const confirmed = await confirm({
      title: '确认切换资源目录',
      message: `确定切换资源目录？\n\n${path}\n\n检测到 ${matchedBooks}/${totalBooks} 本书资源匹配。`,
      confirmText: '确认切换',
      confirmClass: 'bg-primary text-primary-foreground hover:bg-primary/90',
    });
    if (!confirmed) return;
    setSaving(true);
    setMessage('');
    try {
      const data = await updateStorageSettings(path);
      setPath(data.path);
      setWritable(data.writable);
      setMessage(`已切换，匹配 ${data.matchedBooks}/${data.totalBooks} 本书，立即生效`);
    } catch (error: any) {
      setMessage(error?.response?.data?.error || '保存资源目录失败');
    } finally {
      setSaving(false);
    }
  };

  const open = async () => {
    try {
      await openStorageDirectory(path);
    } catch (error: any) {
      setMessage(error?.response?.data?.error || '无法打开目录');
    }
  };

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <div className="bg-background rounded-lg shadow p-6">
        <h2 className="text-base font-semibold text-foreground">资源目录</h2>
        <p className="mt-1 text-sm text-muted-foreground">书籍页面 PNG、PDF 原文件、错题图片、PDF 模块图片和数据库备份共用此目录。</p>
        <p className="mt-1 text-sm text-muted-foreground">目录必须能被后端服务读写；可填写本机路径或已挂载的 NFS/SMB/WebDAV 共享目录。</p>
        <label className="block text-sm font-medium text-foreground mt-5 mb-2">后端可访问的目录路径</label>
        <input
          value={path}
          onChange={(e) => setPath(e.target.value)}
          className="w-full px-3 py-2.5 border border-input rounded-lg text-sm bg-background text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary"
          placeholder="/Volumes/shared/edu-storage"
        />
        <div className="mt-4 flex items-center gap-3">
          <Button onClick={inspect} disabled={checking || !path.trim()} variant="outline">
            <RefreshCw size={15} /> 检查目录
          </Button>
          <Button onClick={save} disabled={saving || !path.trim()} variant="default">
            <Save size={15} /> 保存并切换
          </Button>
          <Button onClick={open} disabled={!path.trim()} variant="outline">
            <FolderOpen size={15} /> 打开目录
          </Button>
        </div>
        <p className="mt-4 text-sm text-muted-foreground">当前检查结果：匹配 {matchedBooks}/{totalBooks} 本书；目录{writable ? '可写' : '未确认可写'}。保存后图片、PDF 和备份均切换到该目录，无需重启服务。</p>
        <p className="mt-1 text-sm text-amber-700 dark:text-amber-400">HTTP 文件服务尚未接入：仅有 URL 无法完成服务端写入、列举和删除。待明确远端 API 协议后可扩展；当前请使用服务端已挂载的共享目录。</p>
        {message && <p className="mt-2 text-sm text-primary">{message}</p>}
      </div>
    </div>
  );
}