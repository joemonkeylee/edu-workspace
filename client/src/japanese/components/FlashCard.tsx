import { useState } from 'react';
import { cn } from '@/lib/utils';

interface FlashCardProps {
  front: string;
  back: string;
  reading?: string;
  mnemonic?: string;
  size?: 'sm' | 'md' | 'lg';
  onFlip?: () => void;
}

/** 可翻转的闪卡 — shadcn 风格 */
export function FlashCard({ front, back, reading, mnemonic, size = 'lg', onFlip }: FlashCardProps) {
  const [flipped, setFlipped] = useState(false);

  const sizes = {
    sm: 'h-24 text-2xl',
    md: 'h-36 text-4xl',
    lg: 'h-48 text-6xl',
  };

  return (
    <div
      className="perspective-1000 w-full cursor-pointer select-none"
      onClick={() => {
        setFlipped((f) => !f);
        onFlip?.();
      }}
    >
      <div
        className={cn(
          'relative w-full transition-transform duration-500',
          flipped && '[transform:rotateY(180deg)]',
        )}
        style={{ transformStyle: 'preserve-3d' }}
      >
        {/* 正面 */}
        <div
          className={cn(
            'flex flex-col items-center justify-center rounded-xl border border-border bg-card shadow-sm',
            sizes[size],
          )}
          style={{ backfaceVisibility: 'hidden' }}
        >
          <span className="font-semibold text-card-foreground">{front}</span>
          {size !== 'sm' && reading && (
            <span className="mt-2 text-base text-muted-foreground">{reading}</span>
          )}
        </div>

        {/* 背面 */}
        <div
          className={cn(
            'absolute inset-0 flex flex-col items-center justify-center rounded-xl border border-primary/30 bg-primary/5 shadow-sm',
            sizes[size],
          )}
          style={{ backfaceVisibility: 'hidden', transform: 'rotateY(180deg)' }}
        >
          <span className="font-semibold text-primary">{back}</span>
          {mnemonic && (
            <p className="mt-3 max-w-sm px-4 text-center text-sm text-muted-foreground">{mnemonic}</p>
          )}
        </div>
      </div>
    </div>
  );
}
