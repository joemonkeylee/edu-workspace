import { useState, useEffect } from 'react';
import { FileText, Trash2, Clock, Layers } from 'lucide-react';
import { getAssignments, deleteAssignment, type Assignment } from '../api/client';
import { formatAssignmentTitle } from '../utils/assignment';

export interface AssignmentListProps {
  bookId: number;
  onSelect: (assignment: Assignment) => void;
  selectedId: number | null;
  onRefresh?: number;
  onCountChange?: (count: number) => void;
}

export default function AssignmentList({ bookId, onSelect, selectedId, onRefresh, onCountChange }: AssignmentListProps) {
  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [loading, setLoading] = useState(true);

  const load = () => {
    setLoading(true);
    getAssignments(bookId).then(({ assignments }) => {
      setAssignments(assignments);
      onCountChange?.(assignments.length);
    }).finally(() => setLoading(false));
  };

  useEffect(() => {
    load();
  }, [bookId, onRefresh]);

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
    return <div className="p-4 text-center text-gray-400 text-sm">暂无作业</div>;
  }

  return (
    <div className="flex flex-col">
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
              <div className="text-sm font-medium text-gray-800 truncate">{formatAssignmentTitle(a.title) || `作业 #${a.id}`}</div>
              <div className="flex items-center gap-2 text-xs text-gray-400 mt-0.5">
                <span className="flex items-center gap-0.5">
                  <Clock size={10} />
                  {formatTime(a.createdAt)}
                </span>
                {a.pages && a.pages.length > 0 && (
                  <span className="flex items-center gap-0.5">
                    <Layers size={10} />
                    第 {a.pages.join('、')} 页
                  </span>
                )}
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
