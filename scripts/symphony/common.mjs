import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, realpathSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const project = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
export const automation = resolve(process.env.SYMPHONY_ROOT ?? `${project}-automation`);
export const repository = join(automation, "repository.git");
export const workspaces = join(automation, "workspaces");
export const records = join(automation, "records");
export const runtime = join(automation, "runtime");
export const upstreamVersion = "0.0.3";
export const upstreamCommit = "1c0fb6c8e8ef9031a2c861e62af5f9e66cee39cb";

export function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    encoding: "utf8",
    timeout: 120_000,
    ...options,
  });
  if (result.error || result.status !== 0) {
    throw new Error(
      `${command} failed: ${result.error?.message ?? result.stderr?.trim() ?? result.status}`,
    );
  }
  return (result.stdout ?? "").trim();
}

export function git(args, options = {}) {
  return run("git", ["--git-dir", repository, ...args], options);
}

export function ensureDirectories() {
  for (const path of [automation, runtime, workspaces, records, join(automation, "logs")]) {
    mkdirSync(path, { recursive: true, mode: 0o700 });
    if (realpathSync(path) !== resolve(path)) throw new Error(`Symlinked automation path: ${path}`);
  }
}

export function readLinearKey() {
  if (process.env.LINEAR_API_KEY) return process.env.LINEAR_API_KEY;
  const path = process.env.SYMPHONY_ENV_FILE ?? join(project, ".env");
  if ((statSync(path).mode & 0o077) !== 0)
    throw new Error("The Linear key file must have permissions 600.");
  const line = readFileSync(path, "utf8")
    .split(/\r?\n/)
    .find((entry) => /^\s*(?:export\s+)?LINEAR_API_KEY\s*=/.test(entry));
  let value = line?.replace(/^\s*(?:export\s+)?LINEAR_API_KEY\s*=\s*/, "").trim();
  if (value?.startsWith('"') && value.endsWith('"')) value = value.slice(1, -1);
  if (value?.startsWith("'") && value.endsWith("'")) value = value.slice(1, -1);
  if (!value || /\s/.test(value))
    throw new Error("A valid LINEAR_API_KEY is required in the project .env.");
  return value;
}

export function releaseDirectory() {
  const output = run(
    join(runtime, `symphony-v${upstreamVersion}-macos_arm64`),
    ["maintenance", "directory"],
    {
      env: { ...process.env, SYMPHONY_INSTALL_DIR: join(runtime, "unpacked") },
    },
  );
  const directory = output.split("\n").at(-1);
  if (!directory?.startsWith(`${runtime}/unpacked/`))
    throw new Error("Unexpected Symphony runtime directory.");
  return directory;
}

export function releaseEnvironment(directory) {
  return { ...process.env, ERL_ROOTDIR: directory, RELEASE_DISTRIBUTION: "none" };
}
