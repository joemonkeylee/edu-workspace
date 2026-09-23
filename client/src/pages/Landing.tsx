import { Link } from 'react-router-dom';
import { BookOpen, Languages } from 'lucide-react';

export default function Landing() {
  return (
    <div className="flex h-full flex-col bg-background text-foreground">
      <header className="bg-sidebar text-sidebar-foreground px-6 py-4 flex items-center justify-between flex-shrink-0 h-14">
        <div className="flex items-center gap-3">
          <BookOpen size={22} />
          <h1 className="text-lg font-normal">edu-workspace</h1>
        </div>
        <div className="flex items-center gap-2">
          <Link to="/books" className="flex items-center gap-1.5 h-9 px-3 rounded-lg transition text-sm text-muted-foreground hover:text-foreground hover:bg-muted">
            <BookOpen size={16} />
            <span>Book</span>
          </Link>
          <Link to="/english" className="flex items-center gap-1.5 h-9 px-3 rounded-lg transition text-sm text-muted-foreground hover:text-foreground hover:bg-muted">
            <Languages size={16} />
            <span>English</span>
          </Link>
        </div>
      </header>
      <main className="flex-1" />
    </div>
  );
}
