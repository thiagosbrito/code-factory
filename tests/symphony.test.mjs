import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
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
import { isDirectReviewTransition, isDirectStateTransition } from "../scripts/symphony/review.mjs";
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
  writeFileSync(
    join(seed, "package.json"),
    JSON.stringify({ scripts: { check: "fixture", "test:package": "fixture" } }),
  );
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
        id: 0,
        method: "thread/start",
        params: {
          dynamicTools: [
            { name: "linear_graphql", description: "Linear", inputSchema: { type: "object" } },
            { type: "namespace", name: "existing", description: "Existing tools", tools: [] },
          ],
        },
      }) +
      "\n" +
      JSON.stringify({
        id: 1,
        method: "turn/start",
        params: { sandboxPolicy: { type: "dangerFullAccess" } },
      }) +
      "\n",
  });
  const [thread, response] = result.split("\n").map((line) => JSON.parse(line));
  assert.deepEqual(
    thread.message.params.dynamicTools.map((tool) => tool.name),
    ["linear_graphql", "existing", "symphony_publish_review", "symphony_checkpoint"],
  );
  assert.deepEqual(
    thread.message.params.dynamicTools.map((tool) => tool.type),
    ["function", "namespace", "function", "function"],
  );
  assert.equal(thread.message.params.dynamicTools[0].description, "Linear");
  assert.deepEqual(thread.message.params.dynamicTools[0].inputSchema, { type: "object" });
  assert.deepEqual(thread.message.params.dynamicTools[1].tools, []);
  assert.equal(response.hasKey, false);
  assert.equal(response.hasGitHubToken, false);
  assert.equal(response.message.params.sandboxPolicy.type, "workspaceWrite");
  assert.deepEqual(response.message.params.sandboxPolicy.writableRoots, [workspace]);
});

test("Codex failed and interrupted turns reach Symphony as failures", (t) => {
  const f = fixture(t);
  const workspace = f.create("THI-FAILURE");
  const fake = join(f.root, "fake-codex.mjs");
  writeFileSync(
    fake,
    '#!/usr/bin/env node\nimport { createInterface } from "node:readline";\nconsole.log(JSON.stringify({ args: process.argv.slice(2) }));\nconst input = createInterface({input:process.stdin}); input.on("line", line => console.log(line));\n',
  );
  chmodSync(fake, 0o755);
  const events = [
    {
      method: "turn/completed",
      params: {
        turn: {
          id: "failed",
          status: "failed",
          error: { message: "Unsupported model", codexErrorInfo: "other" },
        },
      },
    },
    { method: "turn/completed", params: { turn: { id: "stopped", status: "interrupted" } } },
    { method: "turn/completed", params: { turn: { id: "ok", status: "completed", error: null } } },
    { id: 3, result: { turn: { status: "inProgress" } } },
  ];
  for (const model of [undefined, "fixture-model"]) {
    const env = { ...process.env, SYMPHONY_ROOT: f.automation, SYMPHONY_CODEX_BIN: fake };
    delete env.SYMPHONY_CODEX_MODEL;
    if (model) env.SYMPHONY_CODEX_MODEL = model;
    const result = command(process.execPath, [join(project, "scripts/symphony/codex-runner.mjs")], {
      cwd: workspace,
      env,
      input: events.map((event) => JSON.stringify(event)).join("\n") + "\n",
    });
    const [launch, ...output] = result.split("\n").map((line) => JSON.parse(line));
    assert.deepEqual(launch.args, [
      "app-server",
      "-c",
      `model=${JSON.stringify(model ?? "gpt-6-sol")}`,
      "-c",
      "tool_output_token_limit=2000",
      "-c",
      "model_auto_compact_token_limit=40000",
    ]);
    assert.deepEqual(output, [
      { ...events[0], method: "turn/failed" },
      { ...events[1], method: "turn/cancelled" },
      events[2],
      events[3],
    ]);
  }
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

function reviewHarness(f, workspace, mode = "success") {
  const harness = join(f.root, "review-harness.mjs");
  writeFileSync(
    harness,
    String.raw`
    import { readFileSync } from "node:fs";
    import { run } from ${JSON.stringify(join(project, "scripts/symphony/common.mjs"))};
    import { directStateTransitionBlocked, publishReview } from ${JSON.stringify(join(project, "scripts/symphony/review.mjs"))};
    import { beforeRun, afterRun } from ${JSON.stringify(join(project, "scripts/symphony/workspace.mjs"))};
    import { workspaceIdentity, readRecord } from ${JSON.stringify(join(project, "scripts/symphony/workspace-identity.mjs"))};
    const workspace = ${JSON.stringify(workspace)};
    const mode = ${JSON.stringify(mode)};
    const events = [];
    let existing = false;
    const command = (bin, args, options) => {
      if (bin === "pnpm") {
        events.push(args.at(-1));
        if (mode === "validation") throw new Error("Validation failed");
        return "";
      }
      if (bin === "gh") {
        events.push("gh:" + args[1]);
        if (args[1] === "list") return JSON.stringify(existing ? [{number: 1, state: "OPEN"}] : []);
        if (args[1] === "create" && mode === "github") throw new Error("GitHub permission denied");
        if (args[1] === "create" || args[1] === "edit") {
          if (readFileSync(args[args.indexOf("--body-file")+1], "utf8") !== "Reviewed evidence\nValidation passed\n") throw new Error("PR body changed");
          existing = true;
          return "https://github.com/thiagosbrito/code-factory/pull/1";
        }
        if (args[1] === "view") return JSON.stringify({url: "https://github.com/thiagosbrito/code-factory/pull/1",state:"OPEN",isDraft:false,headRefName:"symphony/THI-REVIEW",baseRefName:"main",headRefOid: mode === "mismatch" ? "wrong" : run("git",["rev-parse","HEAD"],{cwd:workspace}),statusCheckRollup: mode === "ci" ? [{conclusion:"FAILURE"}] : [],reviewDecision:null});
        return "";
      }
      if (bin === "git" && args.join(" ") === "remote get-url origin") return "https://github.com/thiagosbrito/code-factory.git";
      return run(bin, args, options);
    };
    let state = "In Progress";
    let staleReads = 0;
    let attachmentCalls = 0;
    let reviewUpdates = 0;
    const linear = async (query, variables) => {
      if (query.includes("issue(id:")) {
        const observed = mode === "stale" && state === "In Review" && staleReads++ < 2 ? "In Progress" : state;
        return {issue: {id: "ticket-id",identifier:"THI-REVIEW",project:{id:"bd22686b-05ec-4184-9bea-4dc9a8ef23af"},state:{name:observed},labels:{nodes:[{name:"symphony-ready"}]},team:{states:{nodes:[{id:"review",name:"In Review"},{id:"backlog",name:"Backlog"}]}}}};
      }
      if (query.includes("attachmentLinkGitHubPR")) { events.push("linear:link"); if (mode === "graphql" && attachmentCalls++ === 0) throw new Error("Linear GraphQL unavailable"); return {attachmentLinkGitHubPR:{success:mode !== "link"}}; }
      if (query.includes("issueUpdate")) {
        state = variables.stateId === "review" ? "In Review" : "Backlog";
        events.push("linear:"+state);
        if (state === "In Review" && reviewUpdates++ === 0 && mode.startsWith("reset-confirm")) state = mode === "reset-confirm-backlog" ? "Backlog" : "In Progress";
        return {issueUpdate:{success:true}};
      }
      throw new Error("Unexpected Linear operation");
    };
    const request = {ready:true,blockers:[],files:["README.md"],commitMessage:"Ticket implementation",title:"THI-REVIEW: implement ticket",body:"Reviewed evidence\nValidation passed\n"};
    if (mode === "path") request.files = ["../outside"];
    const result = await publishReview(workspace, request, {command,linear});
    if (mode === "stale") {
      const identity = workspaceIdentity(workspace);
      await beforeRun(identity, {reconcile: async () => { throw new Error("Linear GraphQL unavailable"); }, prepare: () => events.push("prepare")});
      afterRun(identity);
      events.push("pending-record:" + readRecord(identity).state);
    }
    if (mode === "reset") state = "In Progress";
    if (mode === "reset-backlog") state = "Backlog";
    const pendingBlocked = ["stale", "graphql", "reset", "reset-backlog", "reset-confirm", "reset-confirm-backlog"].includes(mode) ? await directStateTransitionBlocked(workspace, {command,linear}) : null;
    const second = ["success", "stale", "graphql", "reset", "reset-backlog", "reset-confirm", "reset-confirm-backlog"].includes(mode) ? await publishReview(workspace, request, {command,linear}) : null;
    if (second?.success) {
      const identity = workspaceIdentity(workspace);
      await beforeRun(identity, {reconcile: (path) => import(${JSON.stringify(join(project, "scripts/symphony/review.mjs"))}).then(({reconcileReview}) => reconcileReview(path, {command,linear})),prepare: () => events.push("prepare")});
      afterRun(identity);
      events.push("record:" + readRecord(identity).state);
    }
    console.log(JSON.stringify({result,second,pendingBlocked,events,state}));
  `,
  );
  return JSON.parse(
    command(process.execPath, [harness], {
      env: { ...process.env, SYMPHONY_ROOT: f.automation },
    })
      .trim()
      .split("\n")
      .at(-1),
  );
}

test("host publication commits/pushes the owned branch and confirms a PR before In Review; retries reuse it", (t) => {
  const f = fixture(t);
  const workspace = f.create("THI-REVIEW");
  writeFileSync(join(workspace, "README.md"), "reviewed ticket work\n");
  const outcome = reviewHarness(f, workspace);
  assert.equal(outcome.result.success, true);
  assert.equal(outcome.second.success, true);
  assert.equal(outcome.state, "In Review");
  assert.equal(outcome.events.filter((event) => event === "gh:create").length, 1);
  assert.equal(outcome.events.filter((event) => event === "gh:edit").length, 0);
  assert.equal(outcome.events.filter((event) => event === "check").length, 1);
  assert.equal(outcome.events.filter((event) => event === "linear:link").length, 1);
  assert.equal(outcome.events.filter((event) => event === "linear:In Review").length, 1);
  assert.ok(!outcome.events.includes("prepare"));
  assert.ok(outcome.events.includes("record:review-ready"));
  assert.ok(outcome.events.indexOf("gh:view") < outcome.events.indexOf("linear:link"));
  assert.ok(outcome.events.indexOf("linear:link") < outcome.events.indexOf("linear:In Review"));
  assert.equal(command("git", ["-C", workspace, "status", "--porcelain"]), "");
  assert.equal(
    command("git", [
      "--git-dir",
      join(f.root, "remote.git"),
      "rev-parse",
      "refs/heads/symphony/THI-REVIEW",
    ]),
    outcome.result.commit,
  );
  assert.equal(f.hook("after-run", workspace).status, 0);
  const receipt = JSON.parse(readFileSync(join(f.automation, "records/THI-REVIEW.json"), "utf8"));
  assert.equal(receipt.state, "review-ready");
  assert.equal(receipt.url, outcome.result.url);
});

for (const mode of ["validation", "github", "mismatch", "ci", "path"]) {
  test(`publication failure (${mode}) preserves work and never marks the ticket In Review`, (t) => {
    const f = fixture(t);
    const workspace = f.create("THI-REVIEW");
    writeFileSync(join(workspace, "README.md"), "preserved work\n");
    const outcome = reviewHarness(f, workspace, mode);
    assert.equal(outcome.result.success, false);
    assert.ok(!outcome.events.includes("linear:In Review"));
    if (mode !== "path") assert.equal(outcome.state, "Backlog");
    if (mode === "validation" || mode === "path") assert.ok(!outcome.events.includes("gh:create"));
    assert.equal(readFileSync(join(workspace, "README.md"), "utf8"), "preserved work\n");
    const record = JSON.parse(readFileSync(join(f.automation, "records/THI-REVIEW.json"), "utf8"));
    assert.equal(record.state, "publication-blocked");
    assert.ok(record.error);
  });
}

for (const mode of ["stale", "graphql"]) {
  test(`a ${mode} tracker observation reconciles the confirmed PR without a duplicate handoff`, (t) => {
    const f = fixture(t);
    const workspace = f.create("THI-REVIEW");
    writeFileSync(join(workspace, "README.md"), "reviewed ticket work\n");
    const outcome = reviewHarness(f, workspace, mode);
    assert.equal(outcome.result.success, false);
    assert.equal(outcome.result.retryable, true);
    assert.equal(outcome.pendingBlocked, true);
    assert.equal(outcome.second.success, true);
    assert.equal(outcome.state, "In Review");
    assert.equal(outcome.events.filter((event) => event === "check").length, 1);
    assert.equal(outcome.events.filter((event) => event === "gh:create").length, 1);
    assert.equal(
      outcome.events.filter((event) => event === "linear:link").length,
      mode === "graphql" ? 2 : 1,
    );
    assert.equal(outcome.events.filter((event) => event === "linear:In Review").length, 1);
    assert.ok(!outcome.events.includes("prepare"));
    assert.ok(outcome.events.includes("record:review-ready"));
    if (mode === "stale") assert.ok(outcome.events.includes("pending-record:review-pending"));
    assert.equal(outcome.events.filter((event) => event === "linear:Backlog").length, 0);
    const record = JSON.parse(readFileSync(join(f.automation, "records/THI-REVIEW.json"), "utf8"));
    assert.equal(record.state, "review-ready");
    assert.equal(record.commit, outcome.second.commit);
  });
}

for (const mode of ["reset", "reset-backlog"])
  test(`a stale worker cannot reset a confirmed review (${mode})`, (t) => {
    const f = fixture(t);
    const workspace = f.create("THI-REVIEW");
    writeFileSync(join(workspace, "README.md"), "reviewed ticket work\n");
    const outcome = reviewHarness(f, workspace, mode);
    assert.equal(outcome.result.success, true);
    assert.equal(outcome.pendingBlocked, true);
    assert.equal(outcome.second.success, true);
    assert.equal(outcome.state, "In Review");
    assert.equal(outcome.events.filter((event) => event === "check").length, 1);
    assert.equal(outcome.events.filter((event) => event === "gh:create").length, 1);
    assert.equal(outcome.events.filter((event) => event === "linear:In Review").length, 2);
    assert.equal(outcome.events.filter((event) => event === "linear:Backlog").length, 0);
    assert.ok(!outcome.events.includes("prepare"));
    assert.ok(outcome.events.includes("record:review-ready"));
  });

for (const mode of ["reset-confirm", "reset-confirm-backlog"])
  test(`a tracker reset before publication confirmation is repaired (${mode})`, (t) => {
    const f = fixture(t);
    const workspace = f.create("THI-REVIEW");
    writeFileSync(join(workspace, "README.md"), "reviewed ticket work\n");
    const outcome = reviewHarness(f, workspace, mode);
    assert.equal(outcome.result.success, false);
    assert.equal(outcome.result.retryable, true);
    assert.equal(outcome.pendingBlocked, true);
    assert.equal(outcome.second.success, true);
    assert.equal(outcome.state, "In Review");
    assert.equal(outcome.events.filter((event) => event === "check").length, 1);
    assert.equal(outcome.events.filter((event) => event === "gh:create").length, 1);
    assert.equal(outcome.events.filter((event) => event === "linear:link").length, 1);
    assert.equal(outcome.events.filter((event) => event === "linear:In Review").length, 2);
    assert.equal(outcome.events.filter((event) => event === "linear:Backlog").length, 0);
    const record = JSON.parse(readFileSync(join(f.automation, "records/THI-REVIEW.json"), "utf8"));
    assert.equal(record.state, "review-ready");
  });

test("a second invocation stops before launching Codex for a confirmed review", (t) => {
  const f = fixture(t);
  const workspace = f.create("THI-REVIEW");
  writeFileSync(join(workspace, "README.md"), "reviewed ticket work\n");
  const outcome = reviewHarness(f, workspace);
  assert.equal(outcome.result.success, true);
  const marker = join(f.root, "codex-started");
  const fake = join(f.root, "fake-codex.mjs");
  writeFileSync(
    fake,
    `#!/usr/bin/env node\nimport { writeFileSync } from "node:fs";\nwriteFileSync(${JSON.stringify(marker)}, "started");\n`,
  );
  chmodSync(fake, 0o755);
  const second = spawnSync(process.execPath, [join(project, "scripts/symphony/codex-runner.mjs")], {
    cwd: workspace,
    encoding: "utf8",
    timeout: 10_000,
    env: { ...process.env, SYMPHONY_ROOT: f.automation, SYMPHONY_CODEX_BIN: fake },
    input: JSON.stringify({ id: 1, method: "thread/start", params: {} }) + "\n",
  });
  assert.equal(second.status, 0, second.stderr);
  assert.match(second.stderr, /Skipping Codex pickup/);
  assert.equal(second.stdout, "");
  assert.equal(existsSync(marker), false);
  assert.equal(outcome.events.filter((event) => event === "linear:Backlog").length, 0);
});

test("publishing tool calls are handled by the host and their replies return to Codex", async (t) => {
  const f = fixture(t);
  const workspace = f.path("THI-WIRE");
  mkdirSync(workspace);
  const fake = join(f.root, "wire-codex.mjs");
  writeFileSync(
    fake,
    '#!/usr/bin/env node\nimport { createInterface } from "node:readline";\nconst input = createInterface({input:process.stdin}); input.on("line", line => {const message = JSON.parse(line); if(message.method === "thread/start") console.log(JSON.stringify({id:77,method:"item/tool/call",params:{tool:"symphony_publish_review",arguments:{}}})); else if(message.id === 77) { console.log(JSON.stringify({reply:message})); process.exit(0); }});\n',
  );
  chmodSync(fake, 0o755);
  const child = spawn(process.execPath, [join(project, "scripts/symphony/codex-runner.mjs")], {
    cwd: workspace,
    env: { ...process.env, SYMPHONY_ROOT: f.automation, SYMPHONY_CODEX_BIN: fake },
    stdio: "pipe",
  });
  t.after(() => child.kill());
  let output = "";
  let error = "";
  child.stdout.on("data", (chunk) => (output += chunk));
  child.stderr.on("data", (chunk) => (error += chunk));
  const closed = new Promise((resolve, reject) => {
    child.on("error", reject);
    child.on("close", resolve);
  });
  child.stdin.write(JSON.stringify({ id: 1, method: "thread/start", params: {} }) + "\n");
  const timeout = setTimeout(() => child.kill(), 10_000);
  try {
    assert.equal(await closed, 0, error);
  } finally {
    clearTimeout(timeout);
  }
  const messages = output
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));
  assert.equal(messages.length, 1);
  assert.equal(messages[0].reply.id, 77);
  assert.equal(messages[0].reply.result.success, false);
  assert.equal(messages[0].reply.result.contentItems[0].type, "inputText");
  assert.ok(!messages.some((message) => message.method === "item/tool/call"));
});

test("direct Linear review transitions are reserved for the verified host handoff", () => {
  const query =
    'mutation($state: String!) { change: issueUpdate(id: "ticket", input: { stateId: $state }) { success } }';
  assert.equal(
    isDirectReviewTransition({
      tool: "linear_graphql",
      arguments: { query, variables: { state: "e2dcc62e-339f-41f9-bab6-a7b726b6bea9" } },
    }),
    true,
  );
  assert.equal(
    isDirectReviewTransition({
      tool: "linear_graphql",
      arguments: { query, variables: { state: "todo" } },
    }),
    false,
  );
  assert.equal(
    isDirectReviewTransition({
      tool: "linear_graphql",
      arguments: { query: 'query { issue(id: "THI-6") { state { id } } }' },
    }),
    false,
  );
});

test("the host identifies direct issue state changes for a fresh tracker check", () => {
  assert.equal(
    isDirectStateTransition({
      tool: "linear_graphql",
      arguments: {
        query: 'mutation { issueUpdate(id: "ticket", input: { stateId: "progress" }) { success } }',
      },
    }),
    true,
  );
  assert.equal(
    isDirectStateTransition({
      tool: "linear_graphql",
      arguments: {
        query: 'mutation { issueUpdate(id: "ticket", input: { title: "text" }) { success } }',
      },
    }),
    false,
  );
});

test("retained checkpoint is injected once on the next worker's first turn", (t) => {
  const f = fixture(t);
  const workspace = f.create("THI-CONTEXT-WIRE");
  const checkpoint = {
    phase: "implementation",
    summary: "Acceptance: add bounded reads",
    files: ["README.md"],
    remaining: ["Implement bounded reads"],
    validationReceipts: [],
  };
  command(
    process.execPath,
    [
      "--input-type=module",
      "-e",
      `import {saveCheckpoint} from ${JSON.stringify(join(project, "scripts/symphony/context.mjs"))}; saveCheckpoint(process.cwd(), ${JSON.stringify(checkpoint)});`,
    ],
    { cwd: workspace, env: { ...process.env, SYMPHONY_ROOT: f.automation } },
  );
  const fake = join(f.root, "checkpoint-codex.mjs");
  writeFileSync(
    fake,
    '#!/usr/bin/env node\nimport {createInterface} from "node:readline"; createInterface({input:process.stdin}).on("line", line => console.log(line));\n',
  );
  chmodSync(fake, 0o755);
  const request = {
    method: "turn/start",
    params: { input: [{ type: "text", text: "Original task" }] },
  };
  const result = command(process.execPath, [join(project, "scripts/symphony/codex-runner.mjs")], {
    cwd: workspace,
    env: { ...process.env, SYMPHONY_ROOT: f.automation, SYMPHONY_CODEX_BIN: fake },
    input: [request, request].map((value) => JSON.stringify(value)).join("\n") + "\n",
  });
  const [first, second] = result.split("\n").map((line) => JSON.parse(line));
  assert.equal(first.params.input[0].text, "Original task");
  assert.match(first.params.input[1].text, /Checkpoint phase: implementation/);
  assert.deepEqual(second.params.input, request.params.input);
});
