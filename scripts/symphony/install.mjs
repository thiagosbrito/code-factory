import { createHash } from "node:crypto";
import {
  chmodSync,
  copyFileSync,
  existsSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import {
  ensureDirectories,
  releaseDirectory,
  releaseEnvironment,
  run,
  runtime,
  upstreamCommit,
  upstreamVersion,
} from "./common.mjs";

const sourceHash = "b72132293f572fa0c7caa38adda941452072e8639f2c39b4c8a569d69084c6e5";
const hash = (content) => createHash("sha256").update(content).digest("hex");

function replaceOnce(content, before, after) {
  if (content.split(before).length !== 2)
    throw new Error("The pinned upstream cleanup source does not match the patch.");
  return content.replace(before, after);
}

try {
  if (process.platform !== "darwin" || process.arch !== "arm64")
    throw new Error("This installer is pinned to macOS arm64.");
  ensureDirectories();
  const filename = `symphony-v${upstreamVersion}-macos_arm64`;
  if (!existsSync(join(runtime, filename)) || !existsSync(join(runtime, `${filename}.sha256`))) {
    run("gh", [
      "release",
      "download",
      `v${upstreamVersion}`,
      "--repo",
      "openai/symphony",
      "--pattern",
      "*macos_arm64*",
      "--dir",
      runtime,
      "--clobber",
    ]);
  }
  const checksum = readFileSync(join(runtime, `${filename}.sha256`), "utf8")
    .trim()
    .split(/\s+/)[0];
  if (hash(readFileSync(join(runtime, filename))) !== checksum)
    throw new Error("Symphony release checksum mismatch.");
  chmodSync(join(runtime, filename), 0o755);
  // Invalid CLI arguments unpack the runtime without starting the daemon.
  try {
    run(join(runtime, filename), ["--help"], {
      env: { ...process.env, SYMPHONY_INSTALL_DIR: join(runtime, "unpacked") },
    });
  } catch (error) {
    if (!error.message.includes("Usage: symphony")) throw error;
  }
  const directory = releaseDirectory();
  const erts = readdirSync(directory).find((entry) => entry.startsWith("erts-"));
  copyFileSync(join(directory, erts, "bin", "erl.src"), join(directory, erts, "bin", "erl"));
  chmodSync(join(directory, erts, "bin", "erl"), 0o755);

  const response = await fetch(
    `https://raw.githubusercontent.com/openai/symphony/${upstreamCommit}/elixir/lib/symphony_elixir/workspace.ex`,
  );
  if (!response.ok)
    throw new Error(`Could not retrieve pinned workspace source: ${response.status}`);
  const original = await response.text();
  if (hash(original) !== sourceHash) throw new Error("Pinned workspace source checksum mismatch.");
  // Stock Symphony ignores this hook's error and then recursively deletes the worktree.
  let patched = replaceOnce(
    original,
    "    maybe_run_before_remove_hook(workspace, nil)\n    File.rm_rf(workspace)",
    "    with :ok <- maybe_run_before_remove_hook(workspace, nil) do\n      File.rm_rf(workspace)\n    else\n      {:error, reason} -> {:error, reason, workspace}\n    end",
  );
  patched = replaceOnce(
    patched,
    '              "before_remove",\n              nil\n            )\n            |> ignore_hook_failure()',
    '              "before_remove",\n              nil\n            )',
  );
  patched = replaceOnce(
    patched,
    "    case File.rm_rf(workspace) do\n      {:ok, _removed} ->",
    "    result = if File.ls(workspace) == {:ok, []}, do: File.rm_rf(workspace), else: remove_local_workspace(workspace)\n\n    case result do\n      {:ok, _removed} ->",
  );
  const source = join(runtime, "workspace-patched.ex");
  writeFileSync(join(runtime, "workspace-upstream.ex"), original);
  writeFileSync(source, patched);
  const application = readdirSync(join(directory, "lib")).find((entry) =>
    entry.startsWith("symphony_elixir-"),
  );
  const beam = join(directory, "lib", application, "ebin", "Elixir.SymphonyElixir.Workspace.beam");
  const backup = join(runtime, "Workspace.upstream.beam");
  if (!existsSync(backup)) copyFileSync(beam, backup);
  run(
    join(directory, "bin", "symphony"),
    [
      "eval",
      'Code.compiler_options(ignore_module_conflict: true); [{_, binary}] = Code.compile_file(System.get_env("SYMPHONY_PATCH_SOURCE")); File.write!(System.get_env("SYMPHONY_PATCH_BEAM"), binary)',
    ],
    {
      env: {
        ...releaseEnvironment(directory),
        SYMPHONY_PATCH_SOURCE: source,
        SYMPHONY_PATCH_BEAM: beam,
      },
    },
  );
  writeFileSync(
    join(runtime, "manifest.json"),
    JSON.stringify(
      {
        version: upstreamVersion,
        commit: upstreamCommit,
        sourceHash,
        directory,
        beam,
        beamHash: hash(readFileSync(beam)),
        patch: "local cleanup retains workspace when before_remove fails",
      },
      null,
      2,
    ) + "\n",
  );
  console.log(
    `Installed Symphony ${upstreamVersion}; checksum verified; local cleanup patch applied.`,
  );
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
