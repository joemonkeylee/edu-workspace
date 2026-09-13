import { useState } from 'react';
import { getBookCoverUrl } from '../api/client';
import { BookOpen } from 'lucide-react';

interface BookCoverProps {
  book: { id?: number; storagePath?: string; availableDpis?: number[]; coverPage?: number; title?: string; category?: string };
  className?: string;
  pageNumber?: number;
  /**
   * 图片填充方式：
   * - cover（默认）：铺满容器，超出部分裁掉，适合已是目标比例的缩略图位
   * - contain：完整显示整张封面，比例不符时上下/左右留底色，绝不裁切
   */
  fit?: 'cover' | 'contain';
}

// 写成静态字面量，保证 Tailwind 能扫描到这两个类名（动态拼接不会被生成）
const FIT_CLASS: Record<'cover' | 'contain', string> = {
  cover: 'object-cover',
  contain: 'object-contain',
};

export default function BookCover({ book, className, pageNumber, fit = 'cover' }: BookCoverProps) {
  const [loaded, setLoaded] = useState(false);
  // attempt: 0 = primary, 1 = fallback (page 1), 2 = failed
  const [attempt, setAttempt] = useState(0);

  const primaryUrl = getBookCoverUrl(book, pageNumber ?? book.coverPage ?? 1);
  const fallbackUrl = pageNumber && pageNumber !== 1 ? getBookCoverUrl(book, 1) : primaryUrl;

  const url = attempt === 0 ? primaryUrl : attempt === 1 ? fallbackUrl : '';
  const showPlaceholder = attempt >= 2 || !book.id;

  const onError = () => {
    if (attempt < 2) setAttempt(attempt + 1);
  };

  const onLoad = () => setLoaded(true);

  return (
    <div className={`relative overflow-hidden bg-gradient-to-br from-blue-600 to-blue-400 ${className || ''}`}>
      {/* Placeholder */}
      <div
        className={`absolute inset-0 flex flex-col items-center justify-center text-white transition-opacity duration-200 ${
          loaded && !showPlaceholder ? 'opacity-0' : 'opacity-100'
        }`}
      >
        <BookOpen size={28} className="mb-1 opacity-80" />
        <div className="text-xs opacity-70 px-2 text-center line-clamp-2 leading-tight">
          {book.title || book.category || 'No Cover'}
        </div>
      </div>

      {/* Image - fades in on load, never shows broken icon */}
      {!showPlaceholder && url && (
        <img
          src={url}
          alt={book.title || ''}
          className={`absolute inset-0 w-full h-full ${FIT_CLASS[fit]} transition-opacity duration-200 ${
            loaded ? 'opacity-100' : 'opacity-0'
          }`}
          onLoad={onLoad}
          onError={onError}
        />
      )}
    </div>
  );
}
