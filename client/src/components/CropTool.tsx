import { useRef, useState } from 'react';
import ReactCrop, { type Crop } from 'react-image-crop';
import 'react-image-crop/dist/ReactCrop.css';
import { pageImageUrl } from '../api/client';
import { Scissors, Check, X } from 'lucide-react';

interface CropToolProps {
  storagePath: string;
  pageNumber: number;
  zoom: number;
  onSave: (blob: Blob, cropData: { x: number; y: number; w: number; h: number }, subject: string, tags: string) => Promise<void>;
  onCancel: () => void;
}

const SUBJECTS = ['数学', '语文', '英语', '物理', '化学', '生物', '历史', '地理', '政治'];

export default function CropTool({ storagePath, pageNumber, zoom, onSave, onCancel }: CropToolProps) {
  const [crop, setCrop] = useState<Crop>();
  const [completedCrop, setCompletedCrop] = useState<Crop>();
  const [showForm, setShowForm] = useState(false);
  const [subject, setSubject] = useState('');
  const [tags, setTags] = useState('');
  const [saving, setSaving] = useState(false);
  const imgRef = useRef<HTMLImageElement>(null);

  const src = pageImageUrl(storagePath, pageNumber);

  const generateBlob = (): { blob: Blob; cropData: any } | null => {
    if (!completedCrop || !imgRef.current) return null;
    const img = imgRef.current;
    const w = img.naturalWidth;
    const h = img.naturalHeight;
    const cx = (completedCrop.x / 100) * w;
    const cy = (completedCrop.y / 100) * h;
    const cw = (completedCrop.width / 100) * w;
    const ch = (completedCrop.height / 100) * h;

    const canvas = document.createElement('canvas');
    canvas.width = cw;
    canvas.height = ch;
    const ctx = canvas.getContext('2d')!;
    ctx.drawImage(img, cx, cy, cw, ch, 0, 0, cw, ch);

    const cropData = {
      x: completedCrop.x / 100,
      y: completedCrop.y / 100,
      w: completedCrop.width / 100,
      h: completedCrop.height / 100,
    };

    const dataUrl = canvas.toDataURL('image/png');
    const blob = dataURLtoBlob(dataUrl);
    return { blob, cropData };
  };

  const handleConfirm = async () => {
    const result = generateBlob();
    if (!result) return;
    setSaving(true);
    try {
      await onSave(result.blob, result.cropData, subject || '未分类', tags);
      setCrop(undefined);
      setCompletedCrop(undefined);
      setShowForm(false);
      setSubject('');
      setTags('');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="inline-block" style={{ width: `${zoom * 100}%` }}>
      <ReactCrop
        crop={crop}
        onChange={(_, pc) => setCrop(pc)}
        onComplete={(_, pc) => setCompletedCrop(pc)}
      >
        <img
          ref={imgRef}
          src={src}
          alt={`Page ${pageNumber}`}
          className="w-full block select-none"
          draggable={false}
        />
      </ReactCrop>

      {completedCrop && completedCrop.width > 0 && !showForm && (
        <div className="flex justify-center gap-2 mt-3">
          <button
            onClick={() => setShowForm(true)}
            className="flex items-center gap-2 bg-accent hover:bg-amber-600 text-white px-4 py-2 rounded-lg text-sm font-medium transition"
          >
            <Scissors size={16} /> 保存错题
          </button>
          <button
            onClick={onCancel}
            className="flex items-center gap-2 bg-gray-200 hover:bg-gray-300 text-gray-700 px-4 py-2 rounded-lg text-sm font-medium transition"
          >
            取消裁剪
          </button>
        </div>
      )}

      {showForm && (
        <div className="bg-white rounded-lg shadow-lg border border-gray-200 p-3 mt-3 flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2">
            <label className="text-sm text-gray-600">学科</label>
            <input
              list="subjects"
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              placeholder="选择或输入"
              className="w-28 px-2 py-1.5 border border-gray-300 rounded text-sm focus:outline-none focus:ring-2 focus:ring-primary"
            />
            <datalist id="subjects">
              {SUBJECTS.map((s) => (
                <option key={s} value={s} />
              ))}
            </datalist>
          </div>
          <div className="flex items-center gap-2">
            <label className="text-sm text-gray-600">标签</label>
            <input
              type="text"
              value={tags}
              onChange={(e) => setTags(e.target.value)}
              placeholder="逗号分隔"
              className="w-32 px-2 py-1.5 border border-gray-300 rounded text-sm focus:outline-none focus:ring-2 focus:ring-primary"
            />
          </div>
          <div className="flex gap-2 ml-auto">
            <button
              onClick={() => setShowForm(false)}
              className="flex items-center gap-1 bg-gray-200 hover:bg-gray-300 text-gray-700 px-3 py-1.5 rounded text-sm transition"
            >
              <X size={14} /> 取消
            </button>
            <button
              onClick={handleConfirm}
              disabled={saving}
              className="flex items-center gap-1 bg-primary hover:bg-primaryDark disabled:bg-gray-300 text-white px-3 py-1.5 rounded text-sm transition"
            >
              <Check size={14} /> {saving ? '保存中...' : '确认保存'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function dataURLtoBlob(dataUrl: string): Blob {
  const arr = dataUrl.split(',');
  const mime = arr[0].match(/:(.*?);/)![1];
  const bstr = atob(arr[1]);
  const u8 = new Uint8Array(bstr.length);
  for (let i = 0; i < bstr.length; i++) {
    u8[i] = bstr.charCodeAt(i);
  }
  return new Blob([u8], { type: mime });
}
