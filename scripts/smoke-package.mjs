import assert from "node:assert/strict";
import { spawn, execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, mkdir, readdir, readFile, writeFile, rm, access } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { once } from "node:events";

const execute = promisify(execFile);
const scratch = await mkdtemp(join(tmpdir(), "code-factory-package-"));
const packageManager = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
const npm = process.platform === "win32" ? "npm.cmd" : "npm";
let runtime;

try {
  await execute(packageManager, ["pack", "--pack-destination", scratch], { maxBuffer: 2_000_000 });
  const tarball = (await readdir(scratch)).find((name) => name.endsWith(".tgz"));
  assert(tarball, "Pack must produce a tarball");
  const consumer = join(scratch, "consumer");
  const workspace = join(scratch, "workspace");
  await mkdir(consumer);
  await mkdir(join(workspace, ".kiro"), { recursive: true });
  await writeFile(join(workspace, ".kiro", "existing.md"), "Keep my existing agent configuration");
  await writeFile(
    join(consumer, "package.json"),
    JSON.stringify({ private: true, type: "module" }),
  );
  await execute(
    npm,
    [
      "install",
      "--omit=dev",
      "--ignore-scripts",
      "--no-audit",
      "--no-fund",
      "--cache",
      join(scratch, "npm-cache"),
      join(scratch, tarball),
    ],
    { cwd: consumer, maxBuffer: 2_000_000 },
  );
  const cli = join(consumer, "node_modules", "code-factory", "dist", "node", "cli.js");
  assert.match((await execute(process.execPath, [cli, "--help"])).stdout, /code-factory init/);
  await execute(process.execPath, [cli, "init", workspace]);
  const config = JSON.parse(
    await readFile(join(workspace, ".code-factory", "project.json"), "utf8"),
  );
  assert.equal(config.defaultBinding, null);
  assert.equal(
    await readFile(join(workspace, ".kiro", "existing.md"), "utf8"),
    "Keep my existing agent configuration",
  );
  await assert.rejects(execute(process.execPath, [cli, "init", workspace]));
  await assert.rejects(access(join(consumer, "node_modules", "react")));
  await execute(
    process.execPath,
    [
      "--input-type=module",
      "-e",
      'import {createLoopDraft} from "code-factory"; if(createLoopDraft("blank", "Blank").steps.length) throw Error("Not empty");',
    ],
    { cwd: consumer },
  );
  runtime = spawn(process.execPath, [cli, "start", "--project", workspace, "--port", "0"], {
    stdio: ["ignore", "pipe", "pipe"],
  });
  const url = await new Promise((resolveReady, reject) => {
    let output = "";
    const timer = setTimeout(() => reject(new Error("Packaged runtime did not start")), 10_000);
    runtime.once("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    runtime.once("exit", (code) => {
      clearTimeout(timer);
      reject(new Error(`Packaged runtime exited early: ${code}`));
    });
    runtime.stdout.on("data", (data) => {
      output += data.toString();
      const match = output.match(/Code Factory: (http:\/\/127\.0\.0\.1:\d+)/);
      if (match) {
        clearTimeout(timer);
        resolveReady(match[1]);
      }
    });
  });
  assert.equal(
    (await fetch(`${url}/api/health`).then((response) => response.json())).executionAvailable,
    true,
  );
  const page = await fetch(url);
  // The packaged UI can never be framed by another site and runs only its own scripts.
  assert.match(page.headers.get("content-security-policy") ?? "", /frame-ancestors 'none'/);
  assert.equal(page.headers.get("x-frame-options"), "DENY");
  const html = await page.text();
  assert.match(html, /Code Factory/);
  const assets = [...html.matchAll(/(?:src|href)="(\/assets\/[^"]+)"/g)].map((match) => match[1]);
  assert(assets.length >= 2, "Packaged HTML must reference built JS and CSS");
  for (const asset of assets) assert.equal((await fetch(`${url}${asset}`)).status, 200);
  const exited = once(runtime, "exit");
  runtime.kill("SIGTERM");
  assert.equal((await exited)[0], 0);
  runtime = undefined;
  console.log(
    "Package smoke passed: npm production install, public API, blank init, preservation, duplicate-init rejection, packaged UI/assets/API with security headers, and clean shutdown.",
  );
} finally {
  if (runtime && runtime.exitCode === null && runtime.signalCode === null) {
    const exited = once(runtime, "exit");
    runtime.kill("SIGTERM");
    await exited;
  }
  await rm(scratch, { recursive: true, force: true });
}
