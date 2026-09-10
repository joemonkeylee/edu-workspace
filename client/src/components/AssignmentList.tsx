import { useState, useEffect } from 'react';
import { FileText, Trash2, Clock, Layers, CheckCircle, Send } from 'lucide-react';
import { getAssignments, deleteAssignment, updateAssignment, type Assignment } from '../api/client';
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

  const handleDelete = async (e: React.MouseEvent, a: Assignment) => {
    e.stopPropagation();
    if (a.status !== 'draft') return;
    const title = formatAssignmentTitle(a.title) || `作业 #${a.id}`;
    if (!window.confirm(`确认删除作业「${title}」吗？此操作不可撤销。`)) return;
    await deleteAssignment(a.id);
    load();
  };

  const handleSubmit = async (e: React.MouseEvent, a: Assignment) => {
    e.stopPropagation();
    if (a.status !== 'draft') return;
    const title = formatAssignmentTitle(a.title) || `作业 #${a.id}`;
    if (!window.confirm(`确认提交作业「${title}」吗？\n提交后作业将变为只读，无法再修改或删除。`)) return;
    await updateAssignment(a.id, { status: 'submitted' });
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
        {assignments.map((a) => {
          const isDraft = a.status === 'draft';
          const isSubmitted = a.status === 'submitted';
          const isGraded = a.status === 'graded';
          return (
          <button
            key={a.id}
            onClick={() => onSelect(a)}
            className={`w-full flex items-start gap-2 px-3 py-2.5 text-left border-b border-gray-100 transition ${
              selectedId === a.id ? 'bg-[#006064]/10' : 'hover:bg-gray-50'
            }`}
          >
            <FileText size={16} className={`mt-0.5 flex-shrink-0 ${isGraded ? 'text-green-500' : isSubmitted ? 'text-blue-500' : 'text-gray-400'}`} />
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-1.5">
                <span className="text-sm font-medium text-gray-800 truncate">{formatAssignmentTitle(a.title) || `作业 #${a.id}`}</span>
                <span className={`flex-shrink-0 inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[10px] font-medium ${
                  isGraded ? 'bg-green-100 text-green-600'
                    : isSubmitted ? 'bg-blue-100 text-blue-600'
                    : 'bg-gray-100 text-gray-500'
                }`}>
                  {isGraded ? <CheckCircle size={9} /> : null}
                  {isGraded ? '已批改' : isSubmitted ? '已提交' : '草稿'}
                </span>
              </div>
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
              </div>
            </div>
            {isDraft ? (
              <div className="flex-shrink-0 flex items-center gap-0.5">
                <span
                  onClick={(e) => handleSubmit(e, a)}
                  title="提交作业"
                  className="p-1 rounded transition text-gray-300 hover:text-[#006064] hover:bg-[#006064]/10 cursor-pointer"
                >
                  <Send size={14} />
                </span>
                <span
                  onClick={(e) => handleDelete(e, a)}
                  title="删除作业"
                  className="p-1 rounded transition text-gray-300 hover:text-red-500 hover:bg-red-50 cursor-pointer"
                >
                  <Trash2 size={14} />
                </span>
              </div>
            ) : (
              <span className="flex-shrink-0 p-1 text-gray-200">
                <Trash2 size={14} />
              </span>
            )}
          </button>
          );
        })}
      </div>
    </div>
  );
}
