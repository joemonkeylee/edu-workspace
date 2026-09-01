import { useState, useRef, useEffect } from 'react';
import { scanPdfUrl } from '../../api/client';
import { useStore } from '../../store/useStore';
import { Scan, StopCircle, FolderOpen } from 'lucide-react';

export default function PdfScanImport() {
  const [targetPath, setTargetPath] = useState('');
  const [category, setCategory] = useState('');
  const [dpi, setDpi] = useState(200);
  const [logs, setLogs] = useState<string[]>([]);
  const [scanning, setScanning] = useState(false);
  const [progress, setProgress] = useState({ current: 0, total: 0 });

  const esRef = useRef<EventSource | null>(null);
  const doneRef = useRef(false);
  const logEndRef = useRef<HTMLDivElement>(null);
  const { fetchBooks } = useStore();

  const startScan = () => {
    if (!targetPath.trim()) return;
    doneRef.current = false;
    setScanning(true);
    setLogs([]);
    setProgress({ current: 0, total: 0 });

    const url = scanPdfUrl(targetPath.trim(), category.trim(), dpi);
    const es = new EventSource(url);
    esRef.current = es;

    es.addEventListener('log', (e: MessageEvent) => {
      const data = JSON.parse(e.data);
      setLogs((prev) => [...prev, data.message]);
    });
    es.addEventListener('progress', (e: MessageEvent) => {
      const data = JSON.parse(e.data);
      setProgress({ current: data.current, total: data.total });
      setLogs((prev) => [...prev, data.message]);
    });
    es.addEventListener('done', (e: MessageEvent) => {
      const data = JSON.parse(e.data);
      setLogs((prev) => [...prev, `✓ ${data.message}`]);
      doneRef.current = true;
      setScanning(false);
      es.close();
      fetchBooks();
    });
    es.addEventListener('error', (e: Event) => {
      if (doneRef.current) return;
      const me = e as MessageEvent;
      if (me.data) {
        try {
          const data = JSON.parse(me.data);
          setLogs((prev) => [...prev, `✗ ${data.message}`]);
        } catch { /* ignore */ }
      }
      setScanning(false);
      es.close();
    });
  };

  const stopScan = () => {
    esRef.current?.close();
    setScanning(false);
    setLogs((prev) => [...prev, '⏹ 已手动停止']);
  };

  useEffect(() => () => esRef.current?.close(), []);
  useEffect(() => { logEndRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [logs]);

  const pct = progress.total > 0 ? Math.round((progress.current / progress.total) * 100) : 0;

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <div className="bg-white rounded-lg shadow p-6 mb-4">
        <label className="block text-sm font-semibold text-gray-700 mb-2">本地目录绝对路径</label>
        <div className="relative">
          <FolderOpen className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={18} />
          <input
            type="text"
            value={targetPath}
            onChange={(e) => setTargetPath(e.target.value)}
            placeholder="/Users/username/Documents/textbooks 或 C:\Users\..."
            className="w-full pl-10 pr-4 py-2.5 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary text-sm"
            disabled={scanning}
          />
        </div>
        <div className="grid grid-cols-2 gap-4 mt-4">
          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-2">分类（可选）</label>
            <input
              type="text"
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              placeholder="默认取目录名"
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary text-sm"
              disabled={scanning}
            />
          </div>
          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-2">渲染 DPI</label>
            <select
              value={dpi}
              onChange={(e) => setDpi(Number(e.target.value))}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary text-sm"
              disabled={scanning}
            >
              <option value={150}>150 (快)</option>
              <option value={200}>200 (默认)</option>
              <option value={300}>300 (高清)</option>
            </select>
          </div>
        </div>
        <div className="flex gap-3 mt-4">
          <button
            onClick={startScan}
            disabled={scanning || !targetPath.trim()}
            className="flex items-center gap-2 bg-primary hover:bg-primaryDark disabled:bg-gray-300 text-white px-6 py-2.5 rounded-lg transition text-sm font-medium"
          >
            <Scan size={18} /> 开始扫描
          </button>
          {scanning && (
            <button
              onClick={stopScan}
              className="flex items-center gap-2 bg-red-500 hover:bg-red-600 text-white px-4 py-2.5 rounded-lg transition text-sm font-medium"
            >
              <StopCircle size={18} /> 停止
            </button>
          )}
        </div>
      </div>

      {progress.total > 0 && (
        <div className="bg-white rounded-lg shadow p-4 mb-4">
          <div className="flex justify-between text-sm text-gray-600 mb-2">
            <span>渲染进度</span>
            <span>{progress.current}/{progress.total} ({pct}%)</span>
          </div>
          <div className="w-full bg-gray-200 rounded-full h-2.5">
            <div className="bg-primary h-2.5 rounded-full transition-all" style={{ width: `${pct}%` }} />
          </div>
        </div>
      )}

      <div className="bg-gray-900 rounded-lg shadow overflow-hidden">
        <div className="text-gray-400 text-xs px-4 py-2 border-b border-gray-700 font-mono">实时日志控制台</div>
        <div className="font-mono text-sm p-4 h-80 overflow-auto scrollbar-thin">
          {logs.length === 0 && !scanning && <div className="text-gray-500">等待开始扫描...</div>}
          {logs.map((log, i) => (
            <div
              key={i}
              className={
                log.startsWith('✓') ? 'text-green-400'
                  : log.startsWith('✗') ? 'text-red-400'
                    : log.includes('进度') ? 'text-blue-400'
                      : 'text-gray-300'
              }
            >
              {log}
            </div>
          ))}
          {scanning && <div className="text-yellow-400 animate-pulse">▌</div>}
          <div ref={logEndRef} />
        </div>
      </div>
    </div>
  );
}
