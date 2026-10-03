import { createReadStream, readdirSync, statSync, readFileSync } from "node:fs";
import { createInterface } from "node:readline";
import { homedir } from "node:os";
import { basename, join, relative, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";
import { workspaces as defaultWorkspaceRoot, records as defaultRecords } from "./common.mjs";

const DEFAULT_LIMIT = 100;
function listFiles(dir, limit = DEFAULT_LIMIT, out = []) {
  if (out.length >= limit) return out;
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true })
      .map((entry) => {
        const path = join(dir, entry.name);
        try {
          return { entry, path, mtime: statSync(path).mtimeMs };
        } catch {
          return null;
        }
      })
      .filter(Boolean)
      .sort((a, b) => b.mtime - a.mtime);
  } catch {
    return out;
  }
  for (const { entry, path, mtime } of entries) {
    if (out.length >= limit) break;
    if (entry.isDirectory()) listFiles(path, limit, out);
    else if (entry.isFile() && entry.name.endsWith(".jsonl")) out.push({ path, mtime });
  }
  return out;
}
function ticketFor(cwd, root) {
  if (!cwd || !root) return null;
  const base = resolve(root),
    path = resolve(cwd),
    rel = relative(base, path);
  if (!rel || rel === ".." || rel.startsWith(`..${sep}`) || resolve(base, rel) !== path)
    return null;
  const id = rel.split(sep)[0];
  return /^[A-Z][A-Z0-9]*-[A-Z0-9]+$/i.test(id) ? id.toUpperCase() : null;
}
const n = (v) => (Number.isFinite(v) && v >= 0 ? v : 0);

export async function readSession(path, workspaceRoot) {
  const s = {
    id: basename(path, ".jsonl"),
    ticket: null,
    model: null,
    calls: 0,
    inputTokens: 0,
    freshInputTokens: 0,
    cachedInputTokens: 0,
    outputTokens: 0,
    currentContextTokens: 0,
    peakContextTokens: 0,
    phase: null,
  };
  let old = { input: 0, cached: 0, output: 0 },
    lastSignature = null;
  const stream = createReadStream(path);
  try {
    for await (const line of createInterface({ input: stream, crlfDelay: Infinity })) {
      let e;
      try {
        e = JSON.parse(line);
      } catch {
        continue;
      }
      const p = e?.payload ?? {};
      if (e?.type === "session_meta") {
        s.ticket = ticketFor(p.cwd, workspaceRoot);
        if (!s.ticket) return s;
        continue;
      }
      const kind = e?.type === "event_msg" ? p.type : e?.type;
      const data = p;
      if (kind === "turn_context") s.model = data.model ?? s.model;
      if (kind !== "token_count") continue;
      const info = data.info ?? {},
        total = info.total_token_usage,
        last = info.last_token_usage ?? data.last_token_usage,
        usage = total ?? last;
      if (!usage) continue;
      s.calls++;
      const input = n(usage.input_tokens),
        cached = Math.min(input, n(usage.cached_input_tokens)),
        output = n(usage.output_tokens);
      if (total) {
        const sig = `${input}:${cached}:${output}`;
        if (
          sig === lastSignature ||
          (input <= old.input && cached <= old.cached && output <= old.output)
        ) {
          s.calls--;
          continue;
        }
        lastSignature = sig;
        s.inputTokens += Math.max(0, input - old.input);
        s.cachedInputTokens += Math.max(0, cached - old.cached);
        s.outputTokens += Math.max(0, output - old.output);
        old = {
          input: Math.max(old.input, input),
          cached: Math.max(old.cached, cached),
          output: Math.max(old.output, output),
        };
      } else {
        s.inputTokens += input;
        s.cachedInputTokens += cached;
        s.outputTokens += output;
      }
      s.model = data.model ?? info.model ?? s.model;
      s.currentContextTokens = last
        ? n(last.input_tokens) + n(last.output_tokens)
        : n(info.current_context_tokens ?? info.context_tokens);
      s.peakContextTokens = Math.max(s.peakContextTokens, s.currentContextTokens);
    }
  } finally {
    stream.destroy();
  }
  s.freshInputTokens = Math.max(0, s.inputTokens - s.cachedInputTokens);
  return s;
}

export async function auditUsage({
  sessionsDir = join(homedir(), ".codex", "sessions"),
  workspaceRoot = defaultWorkspaceRoot,
  limit = DEFAULT_LIMIT,
  recordsDir = defaultRecords,
} = {}) {
  const files = listFiles(sessionsDir, Math.max(1, limit)).sort((a, b) => b.mtime - a.mtime);
  const sessions = [];
  for (const f of files)
    try {
      const s = await readSession(f.path, workspaceRoot);
      if (s.ticket) sessions.push(s);
    } catch {}
  const checkpoints = {};
  if (recordsDir) {
    let names = [];
    try {
      names = readdirSync(recordsDir).filter((x) =>
        /^[A-Z][A-Z0-9]*-[A-Z0-9]+\.context\.json$/i.test(x),
      );
    } catch {}
    for (const name of names)
      try {
        if (statSync(join(recordsDir, name)).size > 48000) continue;
        const data = JSON.parse(readFileSync(join(recordsDir, name), "utf8"));
        checkpoints[name.replace(/\.context\.json$/, "").toUpperCase()] = [
          "discovery",
          "implementation",
          "validation",
          "publication",
        ].includes(data.phase)
          ? data.phase
          : null;
      } catch {}
  }
  const byTicket = new Map();
  for (const s of sessions) {
    const t = byTicket.get(s.ticket) ?? {
      ticket: s.ticket,
      sessions: 0,
      calls: 0,
      inputTokens: 0,
      freshInputTokens: 0,
      cachedInputTokens: 0,
      outputTokens: 0,
      currentContextTokens: 0,
      peakContextTokens: 0,
      models: {},
    };
    t.sessions++;
    for (const k of [
      "calls",
      "inputTokens",
      "freshInputTokens",
      "cachedInputTokens",
      "outputTokens",
    ])
      t[k] += s[k];
    if (t.sessions === 1) t.currentContextTokens = s.currentContextTokens;
    t.peakContextTokens = Math.max(t.peakContextTokens, s.peakContextTokens);
    if (s.model) t.models[s.model] = (t.models[s.model] ?? 0) + s.calls;
    t.phase = checkpoints[s.ticket] ?? null;
    byTicket.set(s.ticket, t);
  }
  return {
    scannedFiles: files.length,
    tickets: [...byTicket.values()].sort((a, b) => a.ticket.localeCompare(b.ticket)),
    sessions,
  };
}

export function parseArgs(argv) {
  const o = {
    sessionsDir: join(homedir(), ".codex", "sessions"),
    workspaceRoot: defaultWorkspaceRoot,
    recordsDir: defaultRecords,
    port: 4319,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const value = argv[i + 1];
    if (
      ["--sessions-dir", "--workspace-root", "--records-dir", "--limit", "--port"].includes(a) &&
      (value === undefined || value.startsWith("--"))
    )
      throw new Error(`Missing value for ${a}`);
    if (a === "--sessions-dir") o.sessionsDir = argv[++i];
    else if (a === "--workspace-root") o.workspaceRoot = argv[++i];
    else if (a === "--records-dir") o.recordsDir = argv[++i];
    else if (a === "--limit") o.limit = Number(argv[++i]);
    else if (a === "--port") o.port = Number(argv[++i]);
    else throw new Error(`Unknown option: ${a}`);
  }
  if (o.limit !== undefined && (!Number.isInteger(o.limit) || o.limit < 1 || o.limit > 200))
    throw new Error("--limit must be an integer from 1 to 200");
  if (!Number.isInteger(o.port) || o.port < 1 || o.port > 65535)
    throw new Error("--port must be an integer from 1 to 65535");
  return o;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    console.log(JSON.stringify(await auditUsage(parseArgs(process.argv.slice(2))), null, 2));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
