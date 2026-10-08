/**
 * In-process serialization by key: each call waits for the previous holder of the same key, and a
 * failed holder never blocks its successors. It does not coordinate separate processes.
 */
export const createKeyedLock = () => {
  const tails = new Map<string, Promise<unknown>>();
  return async <T>(key: string, work: () => Promise<T>): Promise<T> => {
    const prior = tails.get(key) ?? Promise.resolve();
    const next = prior.catch(() => undefined).then(work);
    tails.set(key, next);
    try {
      return await next;
    } finally {
      if (tails.get(key) === next) tails.delete(key);
    }
  };
};
