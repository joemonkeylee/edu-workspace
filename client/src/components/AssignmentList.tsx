import { useState, useEffect } from 'react';
import { Plus, FileText, Trash2, Clock } from 'lucide-react';
import { getAssignments, createAssignment, deleteAssignment, type Assignment } from '../api/client';

export interface AssignmentListProps {
  bookId: number;
  onSelect: (assignment: Assignment) => void;
  selectedId: number | null;
  onRefresh?: number;
}

function genTimestampTitle(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}

export default function AssignmentList({ bookId, onSelect, selectedId, onRefresh }: AssignmentListProps) {
  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [loading, setLoading] = useState(true);

  const load = () => {
    setLoading(true);
    getAssignments(bookId).then(({ assignments }) => {
      setAssignments(assignments);
    }).finally(() => setLoading(false));
  };

  useEffect(() => {
    load();
  }, [bookId, onRefresh]);

  const handleCreate = async () => {
    const { assignment } = await createAssignment(bookId, genTimestampTitle());
    load();
    onSelect(assignment);
  };

  const handleDelete = async (e: React.MouseEvent, id: number) => {
    e.stopPropagation();
    await deleteAssignment(id);
    load();
  };

  const formatTime = (dateStr: string) => {
    const d = new Date(dateStr);
    const now = new Date();
    const sameDay = d.toDateString() === now.toDateString();
    if (sameDay) return `今天 ${d.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}`;
    return `${d.getMonth() + 1}/${d.getDate()} ${d.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}`;
  };

  if (loading) {
    return <div className="p-4 text-center text-gray-400 text-sm">加载中...</div>;
  }

  if (assignments.length === 0) {
    return (
      <div className="p-4 text-center">
        <p className="text-gray-400 text-sm mb-3">暂无作业</p>
        <button
          onClick={handleCreate}
          className="inline-flex items-center gap-1 px-3 py-1.5 text-sm rounded-lg bg-[#006064] text-white hover:bg-[#00838f]"
        >
          <Plus size={14} /> 新建作业
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-col">
      <div className="px-3 py-2">
        <button
          onClick={handleCreate}
          className="w-full inline-flex items-center justify-center gap-1 px-3 py-1.5 text-sm rounded-lg bg-[#006064] text-white hover:bg-[#00838f]"
        >
          <Plus size={14} /> 新建作业
        </button>
      </div>
      <div className="flex-1 overflow-auto">
        {assignments.map((a) => (
          <button
            key={a.id}
            onClick={() => onSelect(a)}
            className={`w-full flex items-start gap-2 px-3 py-2.5 text-left border-b border-gray-100 transition ${
              selectedId === a.id ? 'bg-[#006064]/10' : 'hover:bg-gray-50'
            }`}
          >
            <FileText size={16} className={`mt-0.5 flex-shrink-0 ${a.status === 'graded' ? 'text-green-500' : 'text-gray-400'}`} />
            <div className="flex-1 min-w-0">
              <div className="text-sm font-medium text-gray-800 truncate">{a.title || `作业 #${a.id}`}</div>
              <div className="flex items-center gap-2 text-xs text-gray-400 mt-0.5">
                <span className="flex items-center gap-0.5">
                  <Clock size={10} />
                  {formatTime(a.createdAt)}
                </span>
                {a._count && <span>· {a._count.strokes} 条笔迹</span>}
                {a.status === 'graded' && <span className="text-green-500">· 已批改</span>}
              </div>
            </div>
            <span
              onClick={(e) => handleDelete(e, a.id)}
              className="flex-shrink-0 p-1 rounded text-gray-300 hover:text-red-500 hover:bg-red-50 cursor-pointer transition"
            >
              <Trash2 size={14} />
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}
