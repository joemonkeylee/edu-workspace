import { useState } from 'react';
import { getBookCoverUrl } from '../api/client';
import { BookOpen } from 'lucide-react';

interface BookCoverProps {
  book: { id?: number; storagePath?: string; availableDpis?: number[]; coverPage?: number; title?: string; category?: string };
  className?: string;
  pageNumber?: number;
}

function defaultCover(title: string, category: string) {
  const label = title?.[0] || category?.[0] || '?';
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 160">
    <defs>
      <linearGradient id="g" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" style="stop-color:#6366f1;stop-opacity:1" />
        <stop offset="100%" style="stop-color:#8b5cf6;stop-opacity:1" />
      </linearGradient>
    </defs>
    <rect width="120" height="160" fill="url(#g)"/>
    <rect x="8" y="8" width="104" height="144" fill="none" stroke="rgba(255,255,255,0.3)" stroke-width="1"/>
    <text x="60" y="85" text-anchor="middle" font-size="36" font-family="sans-serif" font-weight="bold" fill="white">${label.toUpperCase()}</text>
    <text x="60" y="130" text-anchor="middle" font-size="10" font-family="sans-serif" fill="rgba(255,255,255,0.7)">${category || 'Book'}</text>
  </svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

export default function BookCover({ book, className, pageNumber }: BookCoverProps) {
  const [errored, setErrored] = useState(false);
  const [retryErrored, setRetryErrored] = useState(false);

  const primaryUrl = getBookCoverUrl(book, pageNumber ?? book.coverPage ?? 1);
  const fallbackUrl = pageNumber && pageNumber !== 1 ? getBookCoverUrl(book, 1) : primaryUrl;
  const showDefault = errored && retryErrored;

  const handleError = () => {
    if (!errored) {
      setErrored(true);
    } else if (!retryErrored) {
      setRetryErrored(true);
    }
  };

  if (showDefault) {
    return (
      <div
        className={`flex items-center justify-center bg-gradient-to-br from-indigo-500 to-violet-500 ${className || ''}`}
        style={{ aspectRatio: '3/4' }}
      >
        <div className="text-center text-white">
          <BookOpen size={32} className="mx-auto mb-1 opacity-80" />
          <div className="text-xs opacity-70 truncate max-w-[90%] mx-auto">
            {book.title || book.category || 'No Cover'}
          </div>
        </div>
      </div>
    );
  }

  return (
    <img
      src={errored ? fallbackUrl : primaryUrl}
      alt={book.title || ''}
      className={className}
      onError={handleError}
    />
  );
}
