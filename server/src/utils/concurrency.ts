/**
 * Run an array of async tasks with a limited concurrency.
 * Returns results in the same order as the input items.
 */
export async function runWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  if (items.length === 0) return [];

  const results: R[] = new Array(items.length);
  let nextIndex = 0;
  const limit = Math.max(1, Math.min(concurrency, items.length));

  async function workerLoop() {
    while (nextIndex < items.length) {
      const currentIndex = nextIndex++;
      results[currentIndex] = await worker(items[currentIndex], currentIndex);
    }
  }

  const workers = Array.from({ length: limit }, () => workerLoop());
  await Promise.all(workers);
  return results;
}

export async function runWithDynamicConcurrency<T, R>(
  items: T[],
  getConcurrency: () => number,
  worker: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  if (items.length === 0) return [];

  const results: R[] = new Array(items.length);
  let nextIndex = 0;
  let running = 0;
  let completed = 0;
  let settled = false;
  let resolveRun: (value: R[]) => void = () => {};
  let rejectRun: (error: unknown) => void = () => {};

  const run = new Promise<R[]>((resolve, reject) => {
    resolveRun = resolve;
    rejectRun = reject;
  });

  const pump = () => {
    if (settled) return;
    const limit = Math.max(1, Math.min(Math.floor(getConcurrency()), items.length));
    while (nextIndex < items.length && running < limit) {
      const index = nextIndex++;
      running++;
      worker(items[index], index)
        .then((result) => { results[index] = result; })
        .catch((error) => {
          settled = true;
          rejectRun(error);
        })
        .finally(() => {
          running--;
          completed++;
          if (!settled && completed === items.length) {
            settled = true;
            resolveRun(results);
          } else {
            pump();
          }
        });
    }
  };

  const timer = setInterval(pump, 200);
  pump();
  try {
    return await run;
  } finally {
    clearInterval(timer);
  }
}
