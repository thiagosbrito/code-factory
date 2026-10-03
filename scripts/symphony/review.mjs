import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, posix } from "node:path";
import { tmpdir } from "node:os";
import { readLinearKey, run } from "./common.mjs";
import {
  assertOwned,
  withRepositoryLock,
  workspaceIdentity,
  writeRecord,
} from "./workspace-identity.mjs";

const githubRepository = "thiagosbrito/code-factory";
const projectId = "bd22686b-05ec-4184-9bea-4dc9a8ef23af";

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
  const response = await fetch("https://api.linear.app/graphql", {
    method: "POST",
    signal: AbortSignal.timeout(15_000),
    headers: { "Content-Type": "application/json", Authorization: readLinearKey() },
    body: JSON.stringify({ query, variables }),
  });
  const result = await response.json();
  if (!response.ok || result.errors || !result.data)
    throw new Error(
      `Linear request failed (${response.status}); review handoff was not confirmed.`,
    );
  return result.data;
}

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
    issue(id: $id) { id identifier url project { id } state { name }
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
        !/^https:\/\/github\.com\/thiagosbrito\/code-factory\/pull\/\d+$/.test(pr.url)
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

export async function publishReview(
  workspace,
  request,
  { command = run, linear = linearGraphql } = {},
) {
  const identity = workspaceIdentity(workspace);
  assertOwned(identity);
  let issue;
  try {
    issue = await fetchIssue(linear, identity);
    validateRequest(request);
    if (!["Todo", "In Progress", "In Review"].includes(issue.state.name))
      throw new Error("Ticket is paused or terminal; review publication is not authorized.");
    validateCandidate(command, identity.workspace, request.files);
    const pr = publishBranch(identity, request, command);
    // Recheck eligibility after validation/publication; a cancellation must not be overwritten.
    issue = await fetchIssue(linear, identity);
    if (!["Todo", "In Progress", "In Review"].includes(issue.state.name))
      throw new Error("Ticket was paused during publication; leaving its tracker state unchanged.");
    const attachment = await linear(
      `mutation($issueId: String!, $url: String!, $title: String!) {
      attachmentLinkGitHubPR(issueId: $issueId, url: $url, title: $title) { success }
    }`,
      { issueId: issue.id, url: pr.url, title: request.title },
    );
    if (!attachment.attachmentLinkGitHubPR?.success)
      throw new Error("Linear did not confirm the PR link.");
    await moveIssue(linear, issue, "In Review");
    const result = {
      success: true,
      url: pr.url,
      commit: pr.commit,
      state: "In Review",
      checks: pr.statusCheckRollup ?? [],
      reviewDecision: pr.reviewDecision ?? null,
    };
    writeRecord(identity, "review-ready", result);
    return result;
  } catch (error) {
    let pauseError;
    if (issue && ["Todo", "In Progress", "In Review"].includes(issue.state.name)) {
      try {
        const current = await fetchIssue(linear, identity);
        if (["Todo", "In Progress", "In Review"].includes(current.state.name))
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
      paused:
        Boolean(issue) &&
        ["Todo", "In Progress", "In Review"].includes(issue.state.name) &&
        !pauseError,
      ...(pauseError ? { pauseError } : {}),
    };
  }
}
