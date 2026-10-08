import { spawnSync } from "node:child_process";
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { CHANGED_FILES_GATE_PATH } from "../src/domain/gates.js";
import { ensureChangedFilesGate } from "../src/runtime/gates.js";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

const project = async (files: Record<string, string> = {}) => {
  const root = await mkdtemp(join(tmpdir(), "factory-gates-"));
  roots.push(root);
  for (const [path, content] of Object.entries({ "src/a.ts": "export const a = 1\n", ...files })) {
    await mkdir(join(root, path, ".."), { recursive: true });
    await writeFile(join(root, path), content);
  }
  await ensureChangedFilesGate(root);
  return root;
};

/** A fake project tool in node_modules/.bin that records its arguments and runs `body`. */
const tool = async (root: string, name: string, body: string) => {
  await mkdir(join(root, "node_modules", ".bin"), { recursive: true });
  const path = join(root, "node_modules", ".bin", name);
  await writeFile(
    path,
    `#!/usr/bin/env node\nrequire("fs").writeFileSync(${JSON.stringify(join(root, `${name}.args`))}, JSON.stringify(process.argv.slice(2)))\n${body}\n`,
  );
  await chmod(path, 0o755);
};

const gate = (root: string, name: string, changed: string[]) => {
  const result = spawnSync(process.execPath, [CHANGED_FILES_GATE_PATH, name], {
    cwd: root,
    encoding: "utf8",
    env: { ...process.env, CODE_FACTORY_CHANGED_FILES: changed.join("\n") },
  });
  return { code: result.status, output: `${result.stdout}${result.stderr}` };
};

describe("changed-files gate", () => {
  it("is written into .code-factory and rewritten when missing or edited", async () => {
    const root = await project();
    const path = join(root, CHANGED_FILES_GATE_PATH);
    const original = await readFile(path, "utf8");
    await writeFile(path, "// edited\n");
    await ensureChangedFilesGate(root);
    expect(await readFile(path, "utf8")).toBe(original);
    await rm(join(root, ".code-factory"), { recursive: true });
    await ensureChangedFilesGate(root);
    expect(await readFile(path, "utf8")).toBe(original);
  });

  it("lints only the changed code files and reports a missing tool as not applicable", async () => {
    const root = await project({ "README.md": "# r\n" });
    expect(gate(root, "lint", ["src/a.ts"])).toEqual({
      code: 0,
      output: "ESLint is not installed in this project; lint gate not applicable.\n",
    });
    await tool(root, "eslint", "process.exit(1)");
    const failed = gate(root, "lint", ["src/a.ts", "README.md", "src/deleted.ts"]);
    expect(failed.code).toBe(1);
    expect(JSON.parse(await readFile(join(root, "eslint.args"), "utf8"))).toEqual([
      "--quiet",
      "--",
      "src/a.ts",
    ]);
  });

  it("fails types only on errors inside changed files", async () => {
    const root = await project({ "tsconfig.json": "{}", "src/b.ts": "x\n" });
    await tool(
      root,
      "tsc",
      'console.log("src/b.ts(1,1): error TS2304: Cannot find name x.");process.exit(2)',
    );
    expect(gate(root, "types", ["src/a.ts"])).toMatchObject({ code: 0 });
    const failed = gate(root, "types", ["src/b.ts"]);
    expect(failed.code).toBe(1);
    expect(failed.output).toContain("Type errors in changed files: 1.");
  });

  it("requires the coverage threshold per changed source file with Jest", async () => {
    const root = await project({ "src/b.ts": "export const b = 2\n", "src/b.test.ts": "test\n" });
    const summary = (pct: number) =>
      JSON.stringify({
        total: {},
        [join(root, "src/a.ts")]: { lines: { pct: 100 } },
        [join(root, "src/b.ts")]: { lines: { pct } },
      });
    const writeSummary = (pct: number) =>
      `const dir = process.argv.find(a => a.startsWith("--coverageDirectory=")).split("=")[1];require("fs").writeFileSync(dir + "/coverage-summary.json", ${JSON.stringify(summary(pct))})`;
    await tool(root, "jest", writeSummary(80));
    const low = gate(root, "coverage", ["src/a.ts", "src/b.ts", "src/b.test.ts"]);
    expect(low.code).toBe(1);
    expect(low.output).toContain("FAIL     80% lines  src/b.ts");
    expect(low.output).toContain("1 changed file(s) below 90% line coverage.");
    const args = JSON.parse(await readFile(join(root, "jest.args"), "utf8")) as string[];
    expect(args).toContain("--findRelatedTests");
    expect(args).toContain("--collectCoverageFrom=src/b.ts");
    expect(args).not.toContain("src/b.test.ts");
    await tool(root, "jest", writeSummary(95));
    expect(gate(root, "coverage", ["src/b.ts"]).code).toBe(0);
  });

  it("needs a changed-files list or a base commit", async () => {
    const root = await project();
    const { CODE_FACTORY_CHANGED_FILES: _omitted, ...env } = process.env;
    const result = spawnSync(process.execPath, [CHANGED_FILES_GATE_PATH, "lint"], {
      cwd: root,
      encoding: "utf8",
      env,
    });
    expect(result.status).toBe(2);
    expect(result.stdout).toContain("Set CODE_FACTORY_CHANGED_FILES or pass --base");
  });
});
