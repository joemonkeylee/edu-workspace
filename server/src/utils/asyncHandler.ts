import { Request, Response, NextFunction } from 'express';

export function asyncHandler<T = any>(fn: (req: Request, res: Response, next: NextFunction) => Promise<T>) {
  return (req: Request, res: Response, next: NextFunction) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}
