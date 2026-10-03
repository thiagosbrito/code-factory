import { CodexAdapter, CodexStdioRpc } from "../dist/node/adapters/codex.js";
import {
  mkdirSync,
  mkdtempSync,
  writeFileSync,
  readFileSync,
  chmodSync,
  realpathSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
const base = realpathSync(mkdtempSync(join(tmpdir(), "code-factory-native-proof-"))),
  project = base + "/project",
  wrapper = base + "/codex-wrapper";
const quote = (value) => "'" + value.replaceAll("'", "'\"'\"'") + "'";
const options = [
  'model_reasoning_effort="low"',
  "tool_output_token_limit=1000",
  `sqlite_home=${JSON.stringify(base + "/state")}`,
  `log_dir=${JSON.stringify(base + "/log")}`,
];
writeFileSync(
  wrapper,
  "#!/bin/sh\nexec codex " +
    options.map((option) => "-c " + quote(option)).join(" ") +
    ' "$@" 2>> ' +
    quote(base + "/stderr.log") +
    "\n",
);
chmodSync(wrapper, 0o700);
console.log(`Launching native gpt-6-sol proof in ${base}. Provider account usage applies.`);
mkdirSync(project, { recursive: true });
execFileSync("git", ["init", "-q", project]);
const receipt = {
  version: execFileSync(wrapper, ["--version"], { encoding: "utf8" }).trim(),
  model: "gpt-6-sol",
  startedAt: new Date().toISOString(),
  methods: [],
  events: [],
  checks: {},
  failures: [],
};
const timer = setTimeout(() => {
  receipt.failures.push("Probe exceeded 180 seconds");
  finish(1);
}, 180000);
let rpc, adapter;
const instances = [];
function connect() {
  const patches = new Map();
  rpc = new CodexStdioRpc(wrapper, {
    approveFileChange: (message) => {
      const params = message.params ?? {};
      const paths = patches.get(params.itemId) ?? [];
      const approved =
        paths.length > 0 &&
        paths.every((path) =>
          ["proof.txt", "guidance.txt", "retry.txt"].some(
            (name) => resolve(project, name) === resolve(project, path),
          ),
        ) &&
        (!params.grantRoot || resolve(params.grantRoot) === project);
      (receipt.approvals ??= []).push({
        itemId: params.itemId,
        paths,
        decision: approved ? "accept" : "decline",
      });
      return approved;
    },
  });
  rpc.subscribe((message) => {
    const item = message.params?.item;
    if (message.method === "item/started" && item?.type === "fileChange")
      patches.set(
        item.id,
        item.changes.map((change) => change.path),
      );
  });
  instances.push(rpc);
  const traced = {
    request: async (method, params) => {
      try {
        const result = await rpc.request(method, params);
        receipt.methods.push({
          method,
          ok: true,
          ...(method === "turn/steer" ? { acceptedTurnId: result?.turnId } : {}),
        });
        return result;
      } catch (e) {
        receipt.methods.push({ method, ok: false, error: e.message });
        throw e;
      }
    },
    notify: (...x) => rpc.notify(...x),
    subscribe: (...x) => rpc.subscribe(...x),
    close: () => rpc.close(),
  };
  adapter = new CodexAdapter(traced, wrapper, receipt.version.replace("codex-cli ", ""));
  return adapter;
}
function finish(code) {
  clearTimeout(timer);
  for (const r of instances) r.close();
  receipt.finishedAt = new Date().toISOString();
  writeFileSync(base + "/receipt.json", JSON.stringify(receipt, null, 2) + "\n");
  console.log(
    JSON.stringify({
      checks: receipt.checks,
      failures: receipt.failures,
      receipt: base + "/receipt.json",
    }),
  );
  process.exit(code);
}
const signal = AbortSignal.timeout(150000);
const input = {
  runId: "thi6-native-proof",
  stepId: "disposable-edit",
  attempt: 1,
  projectDirectory: project,
  binding: { provider: "codex", model: "gpt-6-sol" },
  instruction:
    "Native proof in disposable project. Work only here. Use the apply_patch tool to create proof.txt containing native-proof. Do not run shell commands or request additional permissions. Before finishing, briefly describe the result. Keep response under 40 words. Do not use network or inspect other folders.",
};
try {
  connect();
  const connection = await adapter.inspect(project);
  receipt.connection = {
    provider: connection.provider,
    version: connection.version,
    authentication: connection.authentication,
    authenticationMechanism: connection.authenticationMechanism,
    modelCount: connection.models?.length,
  };
  receipt.checks.authentication = connection.authentication === "authenticated";
  let session,
    events = [];
  for await (const e of adapter.execute(input, signal)) {
    if (e.type !== "message" || !receipt.events.some((item) => item.type === "message"))
      receipt.events.push({
        type: e.type,
        runId: e.runId,
        stepId: e.stepId,
        attempt: e.attempt,
        sessionId: e.sessionId,
        turnId: e.turnId,
        ...(e.type === "completed" ? { outcome: e.outcome } : {}),
      });
    events.push(e);
    if (e.type === "started") {
      session = {
        runId: e.runId,
        stepId: e.stepId,
        attempt: e.attempt,
        sessionId: e.sessionId,
        turnId: e.turnId,
      };
      receipt.checks.steeringAcknowledged =
        (await adapter.steer(
          session,
          "Additional guidance: also create guidance.txt containing steer-acknowledged before finishing.",
        )) === "supported";
    }
  }
  receipt.checks.started = !!session;
  receipt.checks.streaming = events.some((e) => e.type === "message");
  receipt.checks.completed = events.at(-1)?.outcome === "succeeded";
  receipt.checks.stableIdentity = events.every(
    (e) =>
      e.runId === session.runId &&
      e.stepId === session.stepId &&
      e.attempt === session.attempt &&
      e.sessionId === session.sessionId &&
      e.turnId === session.turnId,
  );
  const has = (file, text) => {
    try {
      return readFileSync(project + "/" + file, "utf8").includes(text);
    } catch {
      return false;
    }
  };
  receipt.checks.editedProject = has("proof.txt", "native-proof");
  receipt.checks.steeringApplied = has("guidance.txt", "steer-acknowledged");
  receipt.completedOutput = events.at(-1)?.output?.slice(0, 1000);
  rpc.close();
  connect();
  let recovered = [];
  for await (const e of adapter.attach(session, signal)) recovered.push(e);
  receipt.recoveredEvents = recovered;
  receipt.checks.recoveryAfterReconnect =
    recovered.at(-1)?.type === "completed" &&
    recovered.at(-1)?.outcome === "succeeded" &&
    recovered.at(-1)?.sessionId === session.sessionId;
  // Deliberately reject an unavailable model, then retry the selected step using the supported model.
  let failedSession;
  let failure = false;
  try {
    for await (const e of adapter.execute(
      {
        ...input,
        stepId: "selected-retry",
        binding: { provider: "codex", model: "thi6-deliberately-unavailable-model" },
      },
      signal,
    )) {
      if (e.type === "started") failedSession = e;
      if (e.type === "completed") failure = e.outcome === "failed";
    }
  } catch (e) {
    failure = true;
    receipt.controlledFailure = e.message;
  }
  receipt.checks.controlledFailure = failure;
  receipt.failedSession = failedSession
    ? { sessionId: failedSession.sessionId, turnId: failedSession.turnId }
    : null;
  let retrySession, retryOutcome;
  for await (const e of adapter.execute(
    {
      ...input,
      stepId: "selected-retry",
      attempt: 2,
      instruction:
        "Disposable proof retry. Use apply_patch to create retry.txt containing retry-succeeded in this project only. Do not run shell commands or request additional permissions. Respond in under 20 words.",
    },
    signal,
  )) {
    if (e.type === "started") retrySession = e;
    if (e.type === "completed") retryOutcome = e.outcome;
  }
  receipt.checks.selectedRetry =
    !!failedSession &&
    !!retrySession &&
    failedSession.sessionId !== retrySession.sessionId &&
    retrySession.attempt === 2 &&
    retryOutcome === "succeeded" &&
    has("retry.txt", "retry-succeeded");
  receipt.retrySession = retrySession
    ? {
        runId: retrySession.runId,
        stepId: retrySession.stepId,
        attempt: retrySession.attempt,
        sessionId: retrySession.sessionId,
        turnId: retrySession.turnId,
        outcome: retryOutcome,
      }
    : null;
  receipt.checks.noInterrupt = receipt.methods.every((x) => x.method !== "turn/interrupt");
  receipt.projectFiles = ["proof.txt", "guidance.txt", "retry.txt"].map((path) => {
    try {
      return { path, content: readFileSync(project + "/" + path, "utf8") };
    } catch {
      return { path, missing: true };
    }
  });
  finish(Object.values(receipt.checks).every(Boolean) ? 0 : 1);
} catch (e) {
  receipt.failures.push(e.message);
  finish(1);
}
