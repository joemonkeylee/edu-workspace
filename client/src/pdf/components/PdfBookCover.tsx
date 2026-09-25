import { useState } from 'react';
import { FileText, AlertTriangle } from 'lucide-react';
import { coverUrl } from '../api/pdfClient';

interface Props {
  book: { id: number; title?: string; category?: string; missing?: boolean; totalPages?: number };
  className?: string;
  /** 列表里可以传更小的宽度，减少首屏解码开销 */
  width?: number;
  fit?: 'cover' | 'contain';
}

const FIT_CLASS: Record<'cover' | 'contain', string> = {
  cover: 'object-cover',
  contain: 'object-contain',
};

/**
 * PDF 书的封面。
 * 封面由服务端按需渲染并落盘缓存，这里只负责懒加载与占位。
 */
export default function PdfBookCover({ book, className, width = 300, fit = 'cover' }: Props) {
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);

  const showPlaceholder = failed || !book.id;

  return (
    <div
      className={`relative overflow-hidden ${fit === 'contain' ? 'bg-white' : 'bg-gradient-to-br from-teal-600 to-teal-400'} ${className || ''}`}
    >
      <div
        className={`absolute inset-0 flex flex-col items-center justify-center text-white transition-opacity duration-200 ${
          loaded && !showPlaceholder ? 'opacity-0' : 'opacity-100'
        }`}
      >
        {book.missing ? (
          <AlertTriangle size={26} className="mb-1 opacity-90" />
        ) : (
          <FileText size={28} className="mb-1 opacity-80" />
        )}
        <div className="text-xs opacity-80 px-2 text-center line-clamp-2 leading-tight">
          {book.missing ? '文件缺失' : book.title || book.category || 'PDF'}
        </div>
      </div>

      {!showPlaceholder && (
        <img
          src={coverUrl(book.id, width)}
          alt={book.title || ''}
          loading="lazy"
          decoding="async"
          className={`absolute inset-0 w-full h-full ${FIT_CLASS[fit]} transition-opacity duration-200 ${
            loaded ? 'opacity-100' : 'opacity-0'
          }`}
          onLoad={() => setLoaded(true)}
          onError={() => setFailed(true)}
        />
      )}
    </div>
  );
}
