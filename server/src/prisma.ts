import { PrismaClient } from '@prisma/client';

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

const basePrisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    datasources: {
      db: {
        url: `${process.env.DATABASE_URL}?connection_limit=10&pool_timeout=60`,
      },
    },
  });

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = basePrisma;
}

// ── Auto backup trigger hook ─────────────────────────────────────
// Scheduler calls setWriteListener(fn) to inject the callback.
// We use $extends to wrap write ops on high-value tables so that
// any code path (router, admin, background job) triggers the debounced backup.

type WriteListener = (model: string, action: string) => void;

let writeListener: WriteListener | null = null;

export function setWriteListener(fn: WriteListener): void {
  writeListener = fn;
}

const CHANGE_TABLES = ['Assignment', 'Annotation', 'Mistake'];
const WRITE_ACTIONS = ['create', 'createMany', 'delete', 'deleteMany', 'update', 'updateMany'];

function buildQueryExtensions() {
  const ext: Record<string, Record<string, any>> = {};
  for (const model of CHANGE_TABLES) {
    ext[model] = {};
    for (const action of WRITE_ACTIONS) {
      ext[model][action] = async ({ args, query }: any) => {
        const result = await query(args);
        if (writeListener) {
          try { writeListener(model.toLowerCase(), action); } catch { /* noop */ }
        }
        return result;
      };
    }
  }
  return { query: ext };
}

// Apply extensions to every model we care about
const prisma = basePrisma.$extends(buildQueryExtensions() as any);

export default prisma;
