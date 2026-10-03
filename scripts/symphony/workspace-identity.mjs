import { mkdirSync, readFileSync, realpathSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { automation, records, repository, run, workspaces } from "./common.mjs";

export function workspaceIdentity(path) {
  const workspace = realpathSync(resolve(path));
  const identifier = basename(workspace);
  if (
    workspace !== join(workspaces, identifier) ||
    !/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(identifier)
  ) {
    throw new Error(
      "Workspace must be an immediate, physical child of the configured workspace root.",
    );
  }
  return { workspace, identifier, branch: `symphony/${identifier}` };
}

export function writeRecord(identity, state, details = {}) {
  const destination = join(records, `${identity.identifier}.json`);
  const temporary = `${destination}.${randomUUID()}.tmp`;
  writeFileSync(
    temporary,
    JSON.stringify(
      { ...identity, ...details, state, updatedAt: new Date().toISOString() },
      null,
      2,
    ) + "\n",
    { mode: 0o600 },
  );
  renameSync(temporary, destination);
}

export function readRecord(identity) {
  return JSON.parse(readFileSync(join(records, `${identity.identifier}.json`), "utf8"));
}

export function assertOwned(identity) {
  const record = readRecord(identity);
  if (record.workspace !== identity.workspace || record.branch !== identity.branch)
    throw new Error("Workspace ownership record does not match.");
  const common = realpathSync(
    run("git", ["-C", identity.workspace, "rev-parse", "--git-common-dir"]),
  );
  if (common !== realpathSync(repository))
    throw new Error("Workspace belongs to another Git repository.");
  const branch = run("git", ["-C", identity.workspace, "branch", "--show-current"]);
  if (branch !== identity.branch)
    throw new Error("The ticket workspace is on an unexpected branch.");
}

export function withRepositoryLock(action) {
  const lock = join(automation, "workspace.lock");
  mkdirSync(lock);
  try {
    writeFileSync(join(lock, "owner.json"), JSON.stringify({ pid: process.pid }), { mode: 0o600 });
    return action();
  } finally {
    rmSync(lock, { recursive: true });
  }
}
