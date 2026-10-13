import { rename } from "node:fs/promises";
import { setTimeout as delay } from "node:timers/promises";

/** Retry transient Windows sharing violations without weakening atomic replacement. */
export const replaceStorageFile = async (
  source: string,
  target: string,
  platform: NodeJS.Platform = process.platform,
): Promise<void> => {
  for (let attempt = 0; ; attempt++) {
    try {
      await rename(source, target);
      return;
    } catch (error) {
      const transient =
        error instanceof Error &&
        "code" in error &&
        ["EPERM", "EBUSY", "EACCES"].includes(String(error.code));
      if (platform !== "win32" || !transient || attempt >= 9) throw error;
      await delay(Math.min(10 * 2 ** attempt, 1000));
    }
  }
};
