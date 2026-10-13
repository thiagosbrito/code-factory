import { chmod, copyFile, writeFile } from "node:fs/promises";

/** Real native processes on every OS; Windows uses a test-only launcher with inherited stdio. */
export const writeNodeExecutable = async (path: string, script: string): Promise<void> => {
  if (process.platform !== "win32") {
    await writeFile(path, script);
    await chmod(path, 0o755);
    return;
  }
  const launcher = process.env.CODE_FACTORY_WINDOWS_FIXTURE;
  if (!launcher) throw new Error("Run scripts/setup-windows-tests.ps1 before Windows tests.");
  process.env.CODE_FACTORY_TEST_NODE = process.execPath;
  await writeFile(`${path}.cjs`, script);
  // Existing discovery/gate fixtures probe the extensionless path. CreateProcess can
  // resolve its .exe sibling; both files contain the same native executable.
  await copyFile(launcher, path);
  await copyFile(launcher, `${path}.exe`);
};
