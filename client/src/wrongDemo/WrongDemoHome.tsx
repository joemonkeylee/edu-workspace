import { Link } from 'react-router-dom';
import { GraduationCap, Info, BookOpen } from 'lucide-react';
import AppHeaderRight from '@/components/AppHeaderRight';
import EnvBadge from '@/components/EnvBadge';
import { WRONG_DEMO_ITEMS, WRONG_DEMO_SUBJECTS, subjectColor } from './items';

/** 与 books / pdf 两个书架保持一致：封面容器按 A4 定比例，图片 contain 不裁切 */
const COVER_ASPECT = '210 / 297';

/**
 * 「错题本样例」列表页。
 *
 * 纯静态：数据来自 ./items.ts，文件由 vite 的 wrong-demo-local-assets 中间件从
 * client/wrong-demo-assets/ 映射出来。不查接口、不建表、不进部署产物。
 */
export default function WrongDemoHome() {
  return (
    <div className="h-full flex flex-col bg-surface">
      <header className="flex h-14 flex-shrink-0 items-center justify-between bg-sidebar px-6 text-sidebar-foreground">
        <div className="flex items-center gap-3">
          <Link to="/" className="flex items-center gap-2">
            <GraduationCap size={22} />
            <span className="text-lg font-normal">edu-workspace</span>
          </Link>
          <EnvBadge />
          <span className="mx-1 h-5 w-px bg-sidebar-border" />
          <div className="flex items-center gap-1.5 text-sm">
            <BookOpen size={15} />
            <span className="font-semibold">错题本样例</span>
          </div>
        </div>
        <AppHeaderRight />
      </header>

      <main className="flex-1 overflow-auto px-6 pt-4 pb-6">
        <div className="mb-4 flex items-start gap-2 rounded-lg border border-border bg-card px-3 py-2 text-xs text-muted-foreground">
          <Info size={14} className="mt-0.5 flex-shrink-0 text-primary" />
          <span>
            共 {WRONG_DEMO_ITEMS.length} 份错题本样例，覆盖 {WRONG_DEMO_SUBJECTS.length} 个学科。
            点击封面即可在站内直接翻阅，不用先下载整个文件。
          </span>
        </div>

        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6">
          {WRONG_DEMO_ITEMS.map((item) => {
            const color = subjectColor(item.subject);
            return (
              <Link key={item.slug} to={`/wrong-demo/${item.slug}`} className="group block">
                <div
                  className="relative overflow-hidden rounded-lg bg-white ring-1 ring-black/5 transition group-hover:shadow-md group-hover:brightness-[1.03]"
                  style={{ aspectRatio: COVER_ASPECT }}
                >
                  <img
                    src={item.cover}
                    alt={item.title}
                    loading="lazy"
                    decoding="async"
                    className="absolute inset-0 h-full w-full object-contain"
                  />

                  <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 via-black/50 to-transparent px-2 pb-2 pt-8">
                    <h3 className="text-xs font-medium leading-tight text-white line-clamp-2" title={item.title}>
                      {item.title}
                    </h3>
                    <div className="mt-1 flex flex-wrap gap-1">
                      <span
                        className="rounded px-1 py-0.5 text-[9px] text-white"
                        style={{ backgroundColor: color.dot }}
                      >
                        {item.subject}
                      </span>
                      <span className="rounded bg-white/20 px-1 py-0.5 text-[9px] text-white">{item.note}</span>
                    </div>
                    <div className="mt-1 text-right text-[10px] text-white/80">{item.pages} 页</div>
                  </div>
                </div>
              </Link>
            );
          })}
        </div>
      </main>
    </div>
  );
}
