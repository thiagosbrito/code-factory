import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, posix } from "node:path";
import { tmpdir } from "node:os";
import { readLinearKey, run } from "./common.mjs";
import {
  assertOwned,
  readRecord,
  withRepositoryLock,
  workspaceIdentity,
  writeRecord,
} from "./workspace-identity.mjs";

const githubRepository = "thiagosbrito/code-factory";
const projectId = "bd22686b-05ec-4184-9bea-4dc9a8ef23af";
const reviewUrl = /^https:\/\/github\.com\/thiagosbrito\/code-factory\/pull\/\d+$/;

export const isDirectStateTransition = (params) =>
  params?.tool === "linear_graphql" &&
  JSON.stringify(params.arguments)?.includes("issueUpdate") &&
  JSON.stringify(params.arguments).includes("stateId");

export function isDirectReviewTransition(params) {
  if (params?.tool !== "linear_graphql") return false;
  const argumentsJson = JSON.stringify(params.arguments);
  return (
    argumentsJson?.includes("issueUpdate") &&
    argumentsJson.includes("e2dcc62e-339f-41f9-bab6-a7b726b6bea9")
  );
}

export const reviewTool = {
  type: "function",
  name: "symphony_publish_review",
  description:
    "Publish validated ticket work through the host: commit, push, create/update its PR, link it in Linear, then set In Review. Call only when all acceptance criteria are met and no blockers remain. Failures pause the issue in Backlog and preserve work.",
  inputSchema: {
    type: "object",
    additionalProperties: false,
    required: ["ready", "blockers", "files", "commitMessage", "title", "body"],
    properties: {
      ready: { type: "boolean" },
      blockers: { type: "array", items: { type: "string" } },
      files: { type: "array", items: { type: "string" } },
      commitMessage: { type: "string" },
      title: { type: "string" },
      body: {
        type: "string",
        description:
          "Problem, resulting behavior, acceptance evidence, validation and actual CI/review results.",
      },
    },
  },
};

async function linearGraphql(query, variables) {
  let response;
  try {
    response = await fetch("https://api.linear.app/graphql", {
      method: "POST",
      signal: AbortSignal.timeout(15_000),
      headers: { "Content-Type": "application/json", Authorization: readLinearKey() },
      body: JSON.stringify({ query, variables }),
    });
  } catch (error) {
    throw new LinearRequestError(`Linear request failed: ${error.message}`);
  }
  let result;
  try {
    result = await response.json();
  } catch {
    throw new LinearRequestError(`Linear response was invalid (${response.status}).`);
  }
  if (!response.ok || result.errors || !result.data)
    throw new LinearRequestError(
      `Linear request failed (${response.status}); review handoff was not confirmed.`,
    );
  return result.data;
}

class LinearRequestError extends Error {}

function validateRequest(request) {
  if (request?.ready !== true || !Array.isArray(request.blockers) || request.blockers.length)
    throw new Error("Review publication requires completed acceptance criteria and no blockers.");
  for (const key of ["commitMessage", "title", "body"])
    if (typeof request[key] !== "string" || !request[key].trim() || request[key].length > 60_000)
      throw new Error(`Missing or invalid review ${key}.`);
  if (!Array.isArray(request.files) || request.files.length > 1000)
    throw new Error("An explicit list of ticket files is required.");
  for (const file of request.files) {
    if (
      typeof file !== "string" ||
      !file ||
      file.includes("\\") ||
      file.includes("\0") ||
      file.startsWith("/") ||
      posix.normalize(file) !== file ||
      file.split("/").some((part) => part === ".git" || part === "..") ||
      /(^|\/)(\.env(?:\..*)?|node_modules|dist)(\/|$)/.test(file)
    )
      throw new Error(
        "Review file paths must be relative ticket sources, without secrets or Git metadata.",
      );
  }
}

async function fetchIssue(linear, identity) {
  const { issue } = await linear(
    `query($id: String!) {
    issue(id: $id) { id identifier url updatedAt project { id } state { name }
      labels { nodes { name } } team { states { nodes { id name } } } }
  }`,
    { id: identity.identifier },
  );
  if (
    !issue ||
    issue.identifier !== identity.identifier ||
    issue.project?.id !== projectId ||
    !issue.labels.nodes.some((label) => label.name === "symphony-ready")
  )
    throw new Error("The owned ticket is not eligible for this project's review publication.");
  return issue;
}

async function moveIssue(linear, issue, state) {
  const stateId = issue.team.states.nodes.find((entry) => entry.name === state)?.id;
  if (!stateId) throw new Error(`Linear state ${state} is missing.`);
  const result = await linear(
    `mutation($id: String!, $stateId: String!) {
    issueUpdate(id: $id, input: { stateId: $stateId }) { success }
  }`,
    { id: issue.id, stateId },
  );
  if (!result.issueUpdate?.success) throw new Error(`Linear did not confirm ${state}.`);
}

function validationEnvironment() {
  return Object.fromEntries(
    Object.entries(process.env).filter(([key]) => !/^(LINEAR_|GITHUB_TOKEN$|GH_TOKEN$)/.test(key)),
  );
}

function validateCandidate(command, workspace, files) {
  const options = { cwd: workspace, env: validationEnvironment(), timeout: 120_000 };
  command("pnpm", ["--config.verify-deps-before-run=false", "check"], options);
  const manifest = JSON.parse(readFileSync(join(workspace, "package.json"), "utf8"));
  if (files.some((file) => /^(scripts\/symphony\/|tests\/symphony|WORKFLOW\.md$)/.test(file)))
    command("pnpm", ["--config.verify-deps-before-run=false", "test:symphony"], options);
  if (
    manifest.scripts?.["test:package"] &&
    files.some((file) =>
      /^(package\.json$|pnpm-lock\.yaml$|scripts\/|src\/(cli|runtime|server|ui)|vite\.config)/.test(
        file,
      ),
    )
  )
    command("pnpm", ["--config.verify-deps-before-run=false", "test:package"], options);
  command("git", ["diff", "--check"], { cwd: workspace });
}

function publishBranch(identity, request, command) {
  return withRepositoryLock(() => {
    assertOwned(identity);
    const git = (...args) => command("git", args, { cwd: identity.workspace });
    const remote = git("remote", "get-url", "origin");
    if (
      !/^(https:\/\/github\.com\/thiagosbrito\/code-factory(?:\.git)?|git@github\.com:thiagosbrito\/code-factory(?:\.git)?)$/.test(
        remote,
      )
    )
      throw new Error("Review publication refuses an unexpected Git remote.");
    const listed = JSON.parse(
      command("gh", [
        "pr",
        "list",
        "--repo",
        githubRepository,
        "--head",
        identity.branch,
        "--state",
        "all",
        "--json",
        "number,state,url",
      ]),
    );
    if (listed.some((pr) => pr.state !== "OPEN"))
      throw new Error("This ticket has a closed/merged PR; a fresh-branch decision is required.");
    if (request.files.length) git("--literal-pathspecs", "add", "--", ...request.files);
    const staged = git("diff", "--cached", "--name-only", "-z").split("\0").filter(Boolean);
    if (staged.some((file) => !request.files.includes(file)))
      throw new Error("The index contains changes outside the ticket's explicit file list.");
    if (git("diff", "--name-only") || git("ls-files", "--others", "--exclude-standard"))
      throw new Error("Unstaged ticket changes remain; include every reviewed source file.");
    git("diff", "--cached", "--check");
    if (staged.length) git("commit", "-m", request.commitMessage);
    const commit = git("rev-parse", "HEAD");
    git("push", "origin", `HEAD:refs/heads/${identity.branch}`);
    const published = git("ls-remote", "origin", `refs/heads/${identity.branch}`).split(/\s/)[0];
    if (published !== commit) throw new Error("Remote branch does not match the reviewed commit.");
    const temporary = mkdtempSync(join(tmpdir(), "symphony-pr-"));
    try {
      const bodyFile = join(temporary, "body.md");
      writeFileSync(bodyFile, request.body, { mode: 0o600 });
      if (listed.length)
        command("gh", [
          "pr",
          "edit",
          String(listed[0].number),
          "--repo",
          githubRepository,
          "--title",
          request.title,
          "--body-file",
          bodyFile,
        ]);
      else
        command("gh", [
          "pr",
          "create",
          "--repo",
          githubRepository,
          "--base",
          "main",
          "--head",
          identity.branch,
          "--title",
          request.title,
          "--body-file",
          bodyFile,
        ]);
      const pr = JSON.parse(
        command("gh", [
          "pr",
          "view",
          identity.branch,
          "--repo",
          githubRepository,
          "--json",
          "url,state,isDraft,headRefName,baseRefName,headRefOid,statusCheckRollup,reviewDecision",
        ]),
      );
      if (
        pr.state !== "OPEN" ||
        pr.headRefName !== identity.branch ||
        pr.baseRefName !== "main" ||
        pr.headRefOid !== commit ||
        !reviewUrl.test(pr.url)
      )
        throw new Error("GitHub did not confirm an open PR for the reviewed commit.");
      if (
        pr.reviewDecision === "CHANGES_REQUESTED" ||
        pr.statusCheckRollup?.some((check) =>
          ["FAILURE", "ERROR", "CANCELLED", "TIMED_OUT", "ACTION_REQUIRED"].includes(
            check.conclusion ?? check.state,
          ),
        )
      )
        throw new Error(
          "The PR has failing CI or requested changes; resolve them before In Review.",
        );
      if (pr.isDraft) {
        command("gh", ["pr", "ready", pr.url, "--repo", githubRepository]);
        const ready = JSON.parse(
          command("gh", [
            "pr",
            "view",
            pr.url,
            "--repo",
            githubRepository,
            "--json",
            "isDraft,state,headRefOid",
          ]),
        );
        if (ready.isDraft || ready.state !== "OPEN" || ready.headRefOid !== commit)
          throw new Error("GitHub did not confirm that the reviewed PR is ready.");
      }
      return { ...pr, isDraft: false, commit };
    } finally {
      rmSync(temporary, { recursive: true, force: true });
    }
  });
}

const reviewResult = (pr) => ({
  success: true,
  url: pr.url,
  commit: pr.commit,
  state: "In Review",
  checks: pr.statusCheckRollup ?? [],
  reviewDecision: pr.reviewDecision ?? null,
});

const verifiedPr = (identity, receipt, command) => {
  if (!reviewUrl.test(receipt.url) || !/^[a-f0-9]{40}$/.test(receipt.commit))
    throw new Error("Publication record has an invalid PR URL or commit.");
  const pr = JSON.parse(
    command("gh", [
      "pr",
      "view",
      receipt.url,
      "--repo",
      githubRepository,
      "--json",
      "url,state,isDraft,headRefName,baseRefName,headRefOid,statusCheckRollup,reviewDecision",
    ]),
  );
  if (
    pr.url !== receipt.url ||
    pr.state !== "OPEN" ||
    pr.isDraft ||
    pr.headRefName !== identity.branch ||
    pr.baseRefName !== "main" ||
    pr.headRefOid !== receipt.commit
  )
    throw new Error("Recorded PR is not open at the verified commit.");
  return { ...pr, commit: receipt.commit };
};

const retryIssue = async (linear, identity) => {
  let failure;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      return await fetchIssue(linear, identity);
    } catch (error) {
      failure = error;
      if (!(error instanceof LinearRequestError) || attempt === 3) break;
    }
  }
  throw failure;
};

export async function reconcileReview(
  workspace,
  { command = run, linear = linearGraphql, allowTransition = true } = {},
) {
  const identity = workspaceIdentity(workspace);
  assertOwned(identity);
  const receipt = readRecord(identity);
  if (!["review-ready", "review-pending"].includes(receipt.state)) return null;
  const pr = verifiedPr(identity, receipt, command);
  const issue = await retryIssue(linear, identity);
  if (issue.state.name === "In Review") {
    const result = reviewResult(pr);
    writeRecord(identity, "review-ready", result);
    return result;
  }
  if (issue.state.name === "Todo") {
    // A fresh Todo transition after publication is the reviewer's request for fixes.
    // A stale pre-publication Todo snapshot must keep the published receipt intact.
    if (
      Number.isFinite(Date.parse(issue.updatedAt)) &&
      Date.parse(issue.updatedAt) > Date.parse(receipt.updatedAt)
    )
      writeRecord(identity, "review-returned", {
        url: receipt.url,
        commit: receipt.commit,
        returnedAt: issue.updatedAt,
      });
    return null;
  }
  if (receipt.state === "review-ready" && ["In Progress", "Backlog"].includes(issue.state.name)) {
    if (!allowTransition) return null;
    await moveIssue(linear, issue, "In Review");
    const confirmed = await retryIssue(linear, identity);
    if (confirmed.state.name !== "In Review")
      throw new LinearRequestError("Linear did not retain the restored review state.");
    const result = reviewResult(pr);
    writeRecord(identity, "review-ready", result);
    return result;
  }
  if (
    receipt.state === "review-ready" ||
    !allowTransition ||
    (!["Todo", "In Progress"].includes(issue.state.name) &&
      !(receipt.stage === "state-transitioned" && issue.state.name === "Backlog"))
  )
    return null;
  if (receipt.stage !== "state-transitioned") {
    if (receipt.stage !== "pr-linked") {
      const attachment = await linear(
        `mutation($issueId: String!, $url: String!, $title: String!) {
          attachmentLinkGitHubPR(issueId: $issueId, url: $url, title: $title) { success }
        }`,
        { issueId: issue.id, url: pr.url, title: receipt.title },
      );
      if (!attachment.attachmentLinkGitHubPR?.success)
        throw new LinearRequestError("Linear did not confirm the PR link.");
      writeRecord(identity, "review-pending", { ...receipt, stage: "pr-linked" });
    }
    await moveIssue(linear, issue, "In Review");
    writeRecord(identity, "review-pending", { ...receipt, stage: "state-transitioned" });
  }
  let confirmed = await retryIssue(linear, identity);
  if (
    confirmed.state.name !== "In Review" &&
    receipt.stage === "state-transitioned" &&
    ["In Progress", "Backlog"].includes(confirmed.state.name)
  ) {
    await moveIssue(linear, confirmed, "In Review");
    confirmed = await retryIssue(linear, identity);
  }
  if (confirmed.state.name !== "In Review")
    throw new LinearRequestError("Linear did not retain In Review after publication.");
  const result = reviewResult(pr);
  writeRecord(identity, "review-ready", result);
  return result;
}

export async function directStateTransitionBlocked(workspace, { linear = linearGraphql } = {}) {
  const identity = workspaceIdentity(workspace);
  const receipt = readRecord(identity);
  if (receipt.state === "review-pending") return true;
  const issue = await retryIssue(linear, identity);
  if (issue.state.name === "In Review") return true;
  if (receipt.state === "review-ready") {
    // A human may return a reviewed ticket to Todo for fixes.
    return issue.state.name !== "Todo";
  }
  return false;
}

export async function publishReview(
  workspace,
  request,
  { command = run, linear = linearGraphql } = {},
) {
  const identity = workspaceIdentity(workspace);
  assertOwned(identity);
  let issue;
  let pr;
  try {
    const previous = readRecord(identity);
    if (["review-ready", "review-pending"].includes(previous.state)) {
      const confirmed = await reconcileReview(workspace, { command, linear });
      if (confirmed) return confirmed;
      if (previous.state === "review-ready")
        return {
          success: false,
          retryable: false,
          paused: false,
          error:
            "Reviewed ticket was returned for changes; run implementation before publishing again.",
        };
    }
    issue = await fetchIssue(linear, identity);
    validateRequest(request);
    if (!["Todo", "In Progress", "In Review"].includes(issue.state.name))
      throw new Error("Ticket is paused or terminal; review publication is not authorized.");
    validateCandidate(command, identity.workspace, request.files);
    pr = publishBranch(identity, request, command);
    writeRecord(identity, "review-pending", {
      url: pr.url,
      commit: pr.commit,
      title: request.title,
      stage: "pr-confirmed",
    });
    // Recheck eligibility after validation/publication; a cancellation must not be overwritten.
    issue = await fetchIssue(linear, identity);
    if (!["Todo", "In Progress", "In Review"].includes(issue.state.name))
      throw new Error("Ticket was paused during publication; leaving its tracker state unchanged.");
    const result = await reconcileReview(workspace, { command, linear });
    if (!result) throw new Error("Review handoff did not reach In Review.");
    return result;
  } catch (error) {
    let pauseError;
    if (pr || ["review-ready", "review-pending"].includes(readRecord(identity).state)) {
      const receipt = readRecord(identity);
      writeRecord(identity, receipt.state === "review-ready" ? "review-ready" : "review-pending", {
        url: receipt.url ?? pr?.url,
        commit: receipt.commit ?? pr?.commit,
        title: receipt.title ?? request?.title,
        stage: receipt.stage ?? "reconciliation-failed",
        error: error.message,
      });
      return {
        success: false,
        error: error.message,
        retryable: true,
        paused: false,
        url: receipt.url ?? pr?.url,
        commit: receipt.commit ?? pr?.commit,
      };
    }
    if (error instanceof LinearRequestError)
      return { success: false, error: error.message, retryable: true, paused: false };
    if (issue && ["Todo", "In Progress"].includes(issue.state.name)) {
      try {
        const current = await retryIssue(linear, identity);
        if (["Todo", "In Progress"].includes(current.state.name))
          await moveIssue(linear, current, "Backlog");
        else pauseError = "Ticket state changed; no pause transition was applied.";
      } catch (failure) {
        pauseError = failure.message;
      }
    }
    writeRecord(identity, "publication-blocked", { error: error.message, pauseError });
    return {
      success: false,
      error: error.message,
      paused: Boolean(issue) && ["Todo", "In Progress"].includes(issue.state.name) && !pauseError,
      ...(pauseError ? { pauseError } : {}),
    };
  }
}
