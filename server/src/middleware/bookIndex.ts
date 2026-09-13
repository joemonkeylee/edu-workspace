import { Request, Response, NextFunction } from 'express';
import { invalidateBookIndex } from '../services/bookIndex.js';

/**
 * 挂在「会改书」的管理路由上：任何写操作成功后让全局书籍索引失效，并在后台重建。
 *
 * 书籍新增/删除、标题修改、配对关系变更都会影响首页列表的判断（答案页集合、配对清单、
 * Tab 计数），但这类操作不频繁，所以用「失败不处理 + 成功后失效 + 后台重建」的粗粒度策略，
 * 好过在每个写接口里各加一行。
 */
export function invalidateBookIndexOnWrite(req: Request, res: Response, next: NextFunction): void {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.on('finish', () => {
      if (res.statusCode < 400) invalidateBookIndex();
    });
  }
  next();
}
