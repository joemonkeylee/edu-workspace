import { Link } from 'react-router-dom';
import { GraduationCap } from 'lucide-react';
import AppHeaderRight from '@/components/AppHeaderRight';

export default function Landing() {
  return (
    <div className="flex h-full flex-col bg-background text-foreground">
      <header className="flex h-14 flex-shrink-0 items-center justify-between bg-sidebar px-6 text-sidebar-foreground">
        <div className="flex items-center gap-3">
          <Link to="/" className="flex items-center gap-2">
            <GraduationCap size={22} />
            <span className="text-lg font-normal">edu-workspace</span>
          </Link>
        </div>
        <AppHeaderRight />
      </header>
      <main className="flex-1" />
    </div>
  );
}
