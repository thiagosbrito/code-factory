import { constants } from "node:fs";
import { access, realpath, stat } from "node:fs/promises";
import { basename, delimiter, dirname, isAbsolute, join, resolve, sep } from "node:path";

/**
 * The real path of `path`, or of its nearest existing ancestor with the missing rest appended, so a
 * path that does not exist yet still compares with real paths (macOS `/var` is `/private/var`).
 */
export const canonicalPath = async (path: string): Promise<string> => {
  const absolute = resolve(path);
  try {
    return await realpath(absolute);
  } catch {
    const parent = dirname(absolute);
    return parent === absolute ? absolute : join(await canonicalPath(parent), basename(absolute));
  }
};

/** Whether canonical `path` is `root` itself or inside it. */
export const isWithin = (root: string, path: string): boolean =>
  path === root || path.startsWith(root.endsWith(sep) ? root : `${root}${sep}`);

/**
 * `npm exec` and `npx` put the project's `node_modules/.bin` on PATH, and a relative PATH entry
 * resolves against the project; both are content of a repository that may be someone else's.
 * Code Factory's own tools (Git, Python) are looked up on PATH without those entries.
 */
const isSystemPathEntry = (entry: string): boolean =>
  isAbsolute(entry) && !entry.split(/[\\/]/).includes("node_modules");

const found = new Map<string, string>();

/**
 * The absolute path of a system tool such as `git` or `python3`. Launching by absolute path also
 * stops Windows from preferring a same-named program in the working directory. A failed lookup is
 * not cached, so installing the tool later works without a restart.
 */
export const systemCommand = async (name: string): Promise<string> => {
  const searchPath = process.env.PATH ?? "";
  const key = `${name}\u0000${searchPath}`;
  const cached = found.get(key);
  if (cached) return cached;
  const names = process.platform === "win32" ? [`${name}.exe`, name] : [name];
  for (const directory of searchPath.split(delimiter).filter(isSystemPathEntry)) {
    for (const candidate of names.map((item) => join(directory, item))) {
      try {
        await access(candidate, constants.X_OK);
        if (!(await stat(candidate)).isFile()) continue;
        found.set(key, candidate);
        return candidate;
      } catch {
        /* Try the next candidate. */
      }
    }
  }
  throw Object.assign(new Error(`${name} was not found on PATH`), { code: "ENOENT" });
};
