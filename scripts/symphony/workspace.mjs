import {
  mkdirSync,
  readFileSync,
  readdirSync,
  realpathSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { basename, join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import {
  automation,
  ensureDirectories,
  git,
  records,
  repository,
  run,
  workspaces,
} from "./common.mjs";

function workspaceIdentity(path) {
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

function writeRecord(identity, state) {
  const destination = join(records, `${identity.identifier}.json`);
  const temporary = `${destination}.${randomUUID()}.tmp`;
  writeFileSync(
    temporary,
    JSON.stringify({ ...identity, state, updatedAt: new Date().toISOString() }, null, 2) + "\n",
    { mode: 0o600 },
  );
  renameSync(temporary, destination);
}

function assertOwned(identity) {
  const record = JSON.parse(readFileSync(join(records, `${identity.identifier}.json`), "utf8"));
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

function withRepositoryLock(action) {
  const lock = join(automation, "workspace.lock");
  mkdirSync(lock);
  try {
    writeFileSync(join(lock, "owner.json"), JSON.stringify({ pid: process.pid }), { mode: 0o600 });
    return action();
  } finally {
    rmSync(lock, { recursive: true });
  }
}

function create(identity) {
  return withRepositoryLock(() => {
    if (readdirSync(identity.workspace).length > 0) {
      assertOwned(identity);
      writeRecord(identity, "reused");
      return;
    }
    // Fetch once under the host lock; existing ticket branches are never reset.
    git(["fetch", "origin"]);
    run("git", ["check-ref-format", "--branch", identity.branch]);
    const branches = git(["for-each-ref", "--format=%(refname)", `refs/heads/${identity.branch}`]);
    if (branches) git(["worktree", "add", identity.workspace, identity.branch]);
    else
      git([
        "worktree",
        "add",
        "-b",
        identity.branch,
        identity.workspace,
        "refs/remotes/origin/main",
      ]);
    writeRecord(identity, "created");
  });
}

function cleanup(identity) {
  return withRepositoryLock(() => {
    assertOwned(identity);
    const changes = run("git", [
      "-C",
      identity.workspace,
      "status",
      "--porcelain",
      "--untracked-files=all",
    ]);
    if (changes) {
      writeRecord(identity, "retained-dirty");
      throw new Error("Retained ticket worktree: tracked changes or untracked files remain.");
    }
    git(["fetch", "origin"]);
    const unpublished = run("git", [
      "-C",
      identity.workspace,
      "rev-list",
      "HEAD",
      "--not",
      "--remotes=origin",
    ]);
    if (unpublished) {
      writeRecord(identity, "retained-unpublished");
      throw new Error("Retained ticket worktree: commits are not present on the remote.");
    }
    git(["worktree", "remove", identity.workspace]);
    writeRecord(identity, "removed");
  });
}

try {
  ensureDirectories();
  const command = process.argv[2];
  const identity = workspaceIdentity(process.argv[3] ?? process.cwd());
  switch (command) {
    case "create":
      create(identity);
      break;
    case "before-run":
      assertOwned(identity);
      run("pnpm", ["install", "--frozen-lockfile"], { cwd: identity.workspace, stdio: "inherit" });
      writeRecord(identity, "running");
      break;
    case "after-run":
      assertOwned(identity);
      writeRecord(identity, "attempt-ended");
      break;
    case "cleanup":
      cleanup(identity);
      break;
    default:
      throw new Error("Expected create, before-run, after-run, or cleanup.");
  }
  console.log(`Workspace ${command}: ${identity.identifier}`);
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
