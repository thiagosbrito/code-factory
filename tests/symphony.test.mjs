import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { test } from "node:test";
import { project, releaseEnvironment, runtime } from "../scripts/symphony/common.mjs";

function command(bin, args, options = {}) {
  const result = spawnSync(bin, args, { encoding: "utf8", timeout: 30_000, ...options });
  assert.ifError(result.error);
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim();
}

function fixture(t) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "code-factory-symphony-")));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const seed = join(root, "seed");
  const remote = join(root, "remote.git");
  const automation = join(root, "automation");
  const repository = join(automation, "repository.git");
  command("git", ["init", "-b", "main", seed]);
  const seedGit = (...args) => command("git", ["-C", seed, ...args]);
  seedGit("config", "user.name", "Fixture");
  seedGit("config", "user.email", "fixture@example.test");
  writeFileSync(join(seed, "README.md"), "baseline\n");
  seedGit("add", ".");
  seedGit("commit", "-m", "Baseline");
  command("git", ["clone", "--bare", seed, remote]);
  mkdirSync(automation);
  command("git", ["clone", "--bare", remote, repository]);
  const git = (...args) => command("git", ["--git-dir", repository, ...args]);
  git("config", "remote.origin.fetch", "+refs/heads/*:refs/remotes/origin/*");
  git("config", "user.name", "Fixture");
  git("config", "user.email", "fixture@example.test");
  git("fetch", "origin");
  const workspaces = join(automation, "workspaces");
  mkdirSync(workspaces);
  const path = (id) => join(workspaces, id);
  const hook = (action, workspace) =>
    spawnSync(
      process.execPath,
      [join(project, "scripts/symphony/workspace.mjs"), action, workspace],
      {
        encoding: "utf8",
        timeout: 30_000,
        env: { ...process.env, SYMPHONY_ROOT: automation },
      },
    );
  const create = (id) => {
    const workspace = path(id);
    mkdirSync(workspace, { recursive: true });
    const result = hook("create", workspace);
    assert.equal(result.status, 0, result.stderr);
    return workspace;
  };
  return { root, automation, repository, workspaces, path, hook, create, git };
}

test("ticket worktrees isolate edits and retain their branch on retry", (t) => {
  const f = fixture(t);
  const first = f.create("THI-TEST1");
  const second = f.create("THI-TEST2");
  writeFileSync(join(first, "README.md"), "ticket edits\n");
  assert.equal(readFileSync(join(second, "README.md"), "utf8"), "baseline\n");
  assert.equal(f.hook("create", first).status, 0);
  assert.equal(readFileSync(join(first, "README.md"), "utf8"), "ticket edits\n");
  assert.equal(command("git", ["-C", first, "branch", "--show-current"]), "symphony/THI-TEST1");
});

test("cleanup preserves dirty and unpublished work; removes only published clean work", (t) => {
  const f = fixture(t);
  const workspace = f.create("THI-TEST3");
  writeFileSync(join(workspace, "new.txt"), "valuable work\n");
  const dirty = f.hook("cleanup", workspace);
  assert.equal(dirty.status, 1);
  assert.match(dirty.stderr, /untracked files/);
  assert.ok(existsSync(join(workspace, "new.txt")));
  command("git", ["-C", workspace, "add", "."]);
  command("git", ["-C", workspace, "commit", "-m", "Ticket work"]);
  const head = command("git", ["-C", workspace, "rev-parse", "HEAD"]);
  const unpublished = f.hook("cleanup", workspace);
  assert.equal(unpublished.status, 1);
  assert.match(unpublished.stderr, /not present on the remote/);
  assert.ok(existsSync(workspace));
  command("git", ["-C", workspace, "push", "origin", "HEAD"]);
  const removed = f.hook("cleanup", workspace);
  assert.equal(removed.status, 0, removed.stderr);
  assert.ok(!existsSync(workspace));
  assert.ok(!f.git("worktree", "list", "--porcelain").includes(workspace));
  f.create("THI-TEST3");
  assert.equal(command("git", ["-C", workspace, "rev-parse", "HEAD"]), head);
});

test("foreign directories, symlinks and an occupied repository lock are rejected", (t) => {
  const f = fixture(t);
  const foreign = f.path("THI-FOREIGN");
  mkdirSync(foreign);
  writeFileSync(join(foreign, "keep.txt"), "do not remove\n");
  assert.equal(f.hook("create", foreign).status, 1);
  assert.ok(existsSync(join(foreign, "keep.txt")));
  const outside = join(f.root, "outside");
  mkdirSync(outside);
  symlinkSync(outside, f.path("THI-LINK"));
  assert.equal(f.hook("create", f.path("THI-LINK")).status, 1);
  mkdirSync(join(f.automation, "workspace.lock"));
  mkdirSync(f.path("THI-LOCKED"));
  assert.equal(f.hook("create", f.path("THI-LOCKED")).status, 1);
  assert.ok(existsSync(join(f.automation, "workspace.lock")));
});

test("Codex transport limits write roots and strips tracker credentials", (t) => {
  const f = fixture(t);
  const workspace = f.create("THI-TRANSPORT");
  const fake = join(f.root, "fake-codex.mjs");
  writeFileSync(
    fake,
    '#!/usr/bin/env node\nimport { createInterface } from "node:readline";\nconst input = createInterface({input:process.stdin}); input.on("line", line => console.log(JSON.stringify({message:JSON.parse(line), hasKey:!!process.env.LINEAR_API_KEY, hasGitHubToken:!!process.env.GH_TOKEN})));\n',
  );
  chmodSync(fake, 0o755);
  const result = command(process.execPath, [join(project, "scripts/symphony/codex-runner.mjs")], {
    cwd: workspace,
    env: {
      ...process.env,
      SYMPHONY_ROOT: f.automation,
      SYMPHONY_CODEX_BIN: fake,
      LINEAR_API_KEY: "fixture-secret",
      GH_TOKEN: "fixture-secret",
    },
    input:
      JSON.stringify({
        id: 1,
        method: "turn/start",
        params: { sandboxPolicy: { type: "dangerFullAccess" } },
      }) + "\n",
  });
  const response = JSON.parse(result);
  assert.equal(response.hasKey, false);
  assert.equal(response.hasGitHubToken, false);
  assert.equal(response.message.params.sandboxPolicy.type, "workspaceWrite");
  assert.deepEqual(response.message.params.sandboxPolicy.writableRoots, [workspace, f.repository]);
});

test(
  "installed Symphony preserves the directory when its removal hook fails",
  { skip: !existsSync(join(runtime, "manifest.json")) },
  (t) => {
    const f = fixture(t);
    const manifest = JSON.parse(readFileSync(join(runtime, "manifest.json"), "utf8"));
    command(
      join(manifest.directory, "bin", "symphony"),
      ["eval", 'Code.require_file(System.get_env("SYMPHONY_TEST_SOURCE"))'],
      {
        env: {
          ...releaseEnvironment(manifest.directory),
          SYMPHONY_TEST_SOURCE: join(project, "tests/symphony-cleanup.exs"),
          SYMPHONY_TEST_ROOT: f.workspaces,
        },
      },
    );
  },
);
