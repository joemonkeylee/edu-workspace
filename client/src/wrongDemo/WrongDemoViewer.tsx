import { Link, useParams } from 'react-router-dom';
import { AlertTriangle } from 'lucide-react';
import PdfBookViewer from '../pdf/pages/PdfBookViewer';
import { findWrongDemo, toPdfBookDetail } from './items';

/**
 * 样例详情页 —— 直接复用 PDF 模块的阅读器（/pdf/book/:id 那套）。
 *
 * 区别在于走「本地文件模式」：书籍信息由静态清单拼成 pdf_book 行的形状传进去，
 * 文件 URL 指向 vite 中间件映射出来的 /wrong-demo/*.pdf，全程不查库。
 * 所以批注 / 做题 / 收藏 / 目录这些要写库或要索引的入口在阅读器里被隐藏了，
 * 保留的是翻页、单双页、缩放、旋转、适应页面这些纯渲染能力。
 */
export default function WrongDemoViewer() {
  const { slug } = useParams<{ slug: string }>();
  const item = findWrongDemo(slug);

  if (!item) {
    return (
      <div className="flex h-full items-center justify-center bg-background">
        <div className="text-center text-sm text-muted-foreground">
          <AlertTriangle className="mx-auto mb-2 text-amber-500" size={28} />
          <p>没有找到名为「{slug}」的样例。</p>
          <Link to="/wrong-demo" className="mt-3 inline-block text-primary hover:underline">
            返回列表
          </Link>
        </div>
      </div>
    );
  }

  return (
    <PdfBookViewer
      local={{
        book: toPdfBookDetail(item),
        fileUrl: item.file,
        backTo: '/wrong-demo',
      }}
    />
  );
}
