/**
 * 并发控制工具 — 限制同时运行的异步任务数量
 *
 * 参考 patentExaminator 的并行批处理方案
 */

/**
 * 带并发限制的 Promise.allSettled
 * @param tasks 任务列表
 * @param concurrency 最大并发数
 * @returns 所有任务的结果
 */
export async function parallelSettled<T>(
  tasks: Array<() => Promise<T>>,
  concurrency: number = 3,
): Promise<PromiseSettledResult<T>[]> {
  const results: PromiseSettledResult<T>[] = new Array(tasks.length);
  let nextIndex = 0;

  const workers = Array.from({ length: Math.min(concurrency, tasks.length) }, async () => {
    while (nextIndex < tasks.length) {
      const index = nextIndex++;
      try {
        const value = await tasks[index]!();
        results[index] = { status: "fulfilled", value };
      } catch (reason) {
        results[index] = { status: "rejected", reason };
      }
    }
  });

  await Promise.all(workers);
  return results;
}

/**
 * 带并发限制的 Promise.all（快速失败）
 * @param tasks 任务列表
 * @param concurrency 最大并发数
 * @returns 所有任务的结果
 */
export async function parallelAll<T>(
  tasks: Array<() => Promise<T>>,
  concurrency: number = 3,
): Promise<T[]> {
  const results: T[] = new Array(tasks.length);
  let nextIndex = 0;

  const workers = Array.from({ length: Math.min(concurrency, tasks.length) }, async () => {
    while (nextIndex < tasks.length) {
      const index = nextIndex++;
      results[index] = await tasks[index]!();
    }
  });

  await Promise.all(workers);
  return results;
}
