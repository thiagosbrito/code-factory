import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  automation,
  ensureDirectories,
  git,
  project,
  readLinearKey,
  releaseEnvironment,
  repository,
  run,
  runtime,
  workspaces,
} from "./common.mjs";
import { MAX_SESSION_MILLISECONDS, parseSessionDuration } from "./session.mjs";

function prepare() {
  ensureDirectories();
  run("git", ["-C", project, "rev-parse", "--verify", "main"]);
  if (!existsSync(repository))
    run("git", ["clone", "--bare", "--no-hardlinks", project, repository]);
  git(["remote", "set-url", "origin", "https://github.com/thiagosbrito/code-factory.git"]);
  git(["config", "remote.origin.fetch", "+refs/heads/*:refs/remotes/origin/*"]);
  git(["config", "user.name", "Codex"]);
  git(["config", "user.email", "codex@openai.com"]);
  git(["config", "credential.helper", "!gh auth git-credential"]);
  console.log("Automation repository prepared; remote main must exist before ticket execution.");
}

function verifyRuntime() {
  const manifest = JSON.parse(readFileSync(join(runtime, "manifest.json"), "utf8"));
  const actual = createHash("sha256").update(readFileSync(manifest.beam)).digest("hex");
  if (actual !== manifest.beamHash)
    throw new Error("Runtime patch changed; run pnpm symphony:install again.");
  return manifest;
}

async function doctor() {
  const manifest = verifyRuntime();
  console.log(`Symphony ${manifest.version}: verified patched runtime`);
  const login = spawnSync("codex", ["login", "status"], { encoding: "utf8", timeout: 10_000 });
  if (login.error || login.status !== 0) throw new Error("Codex is not authenticated.");
  console.log("Codex authentication: present");
  const failures = [];
  try {
    const permissions = JSON.parse(
      run("gh", ["api", "repos/thiagosbrito/code-factory", "--jq", "{permissions, full_name}"]),
    );
    if (!permissions.permissions?.push)
      throw new Error("The active GitHub CLI account cannot push to thiagosbrito/code-factory.");
    console.log("GitHub repository write access: verified");
  } catch (error) {
    failures.push(error.message);
  }
  if (existsSync(join(automation, "workspace.lock")))
    failures.push("Workspace lock exists; inspect its owner before clearing it.");
  try {
    git(["fetch", "origin"]);
    git(["rev-parse", "--verify", "refs/remotes/origin/main"]);
    console.log("Remote main baseline: present");
  } catch {
    failures.push("Remote main baseline is missing; push the developer checkout first.");
  }
  const response = await fetch("https://api.linear.app/graphql", {
    method: "POST",
    signal: AbortSignal.timeout(15_000),
    headers: { "Content-Type": "application/json", Authorization: readLinearKey() },
    body: JSON.stringify({
      query:
        'query { viewer { id } projects(filter: { slugId: { eq: "e116ab6d4aee" } }) { nodes { id name } } }',
    }),
  });
  const result = await response.json();
  if (
    !response.ok ||
    result.errors ||
    !result.data?.viewer ||
    !result.data.projects.nodes.some((entry) => entry.id === "bd22686b-05ec-4184-9bea-4dc9a8ef23af")
  ) {
    throw new Error("Linear authentication/project access could not be verified.");
  }
  console.log("Linear authentication and Code Factory project: verified");
  if (failures.length) throw new Error(failures.join("\n"));
  return manifest;
}

async function start() {
  const manifest = await doctor();
  const lock = join(automation, "daemon.lock");
  const minutes = parseSessionDuration(process.env.SYMPHONY_RUN_MINUTES);
  const environment = {
    ...releaseEnvironment(manifest.directory),
    SYMPHONY_ROOT: automation,
    SYMPHONY_PROJECT: project,
    SYMPHONY_WORKSPACE_ROOT: workspaces,
    LINEAR_API_KEY: readLinearKey(),
  };
  mkdirSync(lock);
  const child = spawn(
    join(manifest.directory, "bin", "symphony"),
    [
      "eval",
      "SymphonyElixir.CLI.main(System.argv())",
      "--i-understand-that-this-will-be-running-without-the-usual-guardrails",
      "--logs-root",
      join(automation, "logs"),
      join(project, "WORKFLOW.md"),
    ],
    { env: environment, stdio: "inherit", detached: true },
  );
  if (child.pid)
    writeFileSync(
      join(lock, "owner.json"),
      JSON.stringify({
        pid: process.pid,
        childPid: child.pid,
        startedAt: new Date().toISOString(),
      }),
      { mode: 0o600 },
    );
  let escalation;
  let stopping = false;
  const stop = () => {
    try {
      process.kill(-child.pid, "SIGTERM");
    } catch {
      /* Already stopped. */
    }
  };
  const stopWithDeadline = () => {
    stopping = true;
    stop();
    escalation ??= setTimeout(() => {
      try {
        process.kill(-child.pid, "SIGKILL");
      } catch {
        /* Already stopped. */
      }
    }, 10_000);
  };
  const timeout =
    minutes === null
      ? undefined
      : setTimeout(
          () => {
            console.log("Symphony session time limit reached; stopping.");
            stopWithDeadline();
          },
          Math.max(1, Math.min(MAX_SESSION_MILLISECONDS, Math.floor(minutes * 60_000))),
        );
  process.on("SIGINT", stopWithDeadline);
  process.on("SIGTERM", stopWithDeadline);
  child.on("error", () => {
    console.error("Symphony failed to launch.");
    process.exitCode = 1;
  });
  child.on("close", (code) => {
    if (timeout) clearTimeout(timeout);
    clearTimeout(escalation);
    rmSync(lock, { recursive: true });
    process.exitCode = stopping ? 0 : (code ?? 1);
  });
  console.log(
    `Symphony started; session limit ${minutes === null ? "unlimited" : `${minutes} minutes`}; dashboard http://127.0.0.1:4318`,
  );
}

try {
  switch (process.argv[2]) {
    case "prepare":
      prepare();
      break;
    case "doctor":
      await doctor();
      break;
    case "start":
      await start();
      break;
    default:
      throw new Error("Expected prepare, doctor, or start.");
  }
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
