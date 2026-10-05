import { readdirSync } from "node:fs";
import { ensureDirectories, git, run } from "./common.mjs";
import { reconcileReview } from "./review.mjs";

import {
  readRecord,
  workspaceIdentity,
  writeRecord,
  assertOwned,
  withRepositoryLock,
} from "./workspace-identity.mjs";

function create(identity) {
  return withRepositoryLock(() => {
    if (readdirSync(identity.workspace).length > 0) {
      assertOwned(identity);
      if (!["review-ready", "review-pending"].includes(readRecord(identity).state))
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
      if (["review-ready", "review-pending"].includes(readRecord(identity).state)) {
        const confirmed = await reconcileReview(identity.workspace);
        if (confirmed)
          throw new Error(`Review already published: ${confirmed.url} at ${confirmed.commit}.`);
        if (readRecord(identity).state === "review-pending")
          throw new Error("Review reconciliation is pending; refusing duplicate pickup.");
      }
      withRepositoryLock(() => git(["fetch", "origin"]));
      run("pnpm", ["install", "--frozen-lockfile"], { cwd: identity.workspace, stdio: "inherit" });
      writeRecord(identity, "running");
      break;
    case "after-run":
      assertOwned(identity);
      if (
        !["review-ready", "review-pending", "publication-blocked"].includes(
          readRecord(identity).state,
        )
      )
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
