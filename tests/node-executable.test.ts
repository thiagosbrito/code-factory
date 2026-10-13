import { spawn } from "node:child_process";
import { mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { writeNodeExecutable } from "./support/node-executable.js";

it("launches shared fixtures with literal argv, inherited cwd, and stdin on every OS", async () => {
  const directory = await mkdtemp(join(tmpdir(), "factory fixture space-"));
  try {
    const executable = join(directory, "fixture");
    const args = ["space value", 'quote"value', "%PATH%", "line\nbreak", "trailing\\"];
    await writeNodeExecutable(
      executable,
      `#!/usr/bin/env node
console.log(JSON.stringify({ cwd: process.cwd(), args: process.argv.slice(2), input: require('fs').readFileSync(0, 'utf8') }));
`,
    );
    const result = await new Promise<string>((resolve, reject) => {
      const child = spawn(executable, args, { cwd: directory, stdio: ["pipe", "pipe", "pipe"] });
      let output = "";
      let errors = "";
      child.stdout.on("data", (chunk: Buffer) => {
        output += chunk.toString();
      });
      child.stderr.on("data", (chunk: Buffer) => {
        errors += chunk.toString();
      });
      child.once("error", reject);
      child.once("close", (code) => (code === 0 ? resolve(output) : reject(new Error(errors))));
      child.stdin.end("fixture input\n");
    });
    expect(JSON.parse(result)).toEqual({
      cwd: await realpath(directory),
      args,
      input: "fixture input\n",
    });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
