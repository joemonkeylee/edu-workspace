import { useEffect, useState } from 'react';
import { FolderOpen, RefreshCw, Save } from 'lucide-react';
import { getStorageSettings, inspectStorageSettings, openStorageDirectory, updateStorageSettings } from '../../api/client';

export default function StorageSettings() {
  const [path, setPath] = useState('');
  const [matchedBooks, setMatchedBooks] = useState(0);
  const [totalBooks, setTotalBooks] = useState(0);
  const [checking, setChecking] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');

  const load = async () => {
    const data = await getStorageSettings();
    setPath(data.path);
    setMatchedBooks(data.matchedBooks);
    setTotalBooks(data.totalBooks);
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
      setMessage(`检测到 ${data.matchedBooks}/${data.totalBooks} 本书的资源`);
    } catch (error: any) {
      setMessage(error?.response?.data?.error || '目录检查失败');
    } finally {
      setChecking(false);
    }
  };

  const save = async () => {
    if (!path.trim()) return;
    if (!window.confirm(`确定切换资源目录？\n\n${path}\n\n检测到 ${matchedBooks}/${totalBooks} 本书资源匹配。`)) return;
    setSaving(true);
    setMessage('');
    try {
      const data = await updateStorageSettings(path);
      setPath(data.path);
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
      <div className="bg-white rounded-lg shadow p-6">
        <h2 className="text-base font-semibold text-gray-800">资源目录</h2>
        <p className="mt-1 text-sm text-gray-500">书籍页面、PDF 原文件和错题裁剪图片都会存放在此目录。</p>
        <label className="block text-sm font-medium text-gray-700 mt-5 mb-2">本机绝对路径</label>
        <input
          value={path}
          onChange={(e) => setPath(e.target.value)}
          className="w-full px-3 py-2.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary"
          placeholder="/Users/username/Documents/edu-storage"
        />
        <div className="mt-4 flex items-center gap-3">
          <button onClick={inspect} disabled={checking || !path.trim()} className="flex items-center gap-1.5 rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-700 hover:border-primary hover:text-primary disabled:opacity-50">
            <RefreshCw size={15} /> 检查目录
          </button>
          <button onClick={save} disabled={saving || !path.trim()} className="flex items-center gap-1.5 rounded-lg bg-primary px-3 py-2 text-sm text-white hover:bg-primaryDark disabled:opacity-50">
            <Save size={15} /> 保存并切换
          </button>
          <button onClick={open} disabled={!path.trim()} className="flex items-center gap-1.5 rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-700 hover:border-primary hover:text-primary disabled:opacity-50">
            <FolderOpen size={15} /> 打开目录
          </button>
        </div>
        <p className="mt-4 text-sm text-gray-500">当前检查结果：匹配 {matchedBooks}/{totalBooks} 本书。切换后立即生效，无需重启服务。</p>
        {message && <p className="mt-2 text-sm text-primary">{message}</p>}
      </div>
    </div>
  );
}