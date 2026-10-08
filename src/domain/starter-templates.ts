import {
  changedFilesGateCommand,
  DEFAULT_COVERAGE_THRESHOLD,
  type ChangedFilesGate,
} from "./gates.js";
import { parseLoop, type LoopDefinition } from "./loop.js";

export type StarterId = "compact" | "staged";

export const starterTemplates: { id: StarterId; name: string; description: string }[] = [
  {
    id: "compact",
    name: "Implement → Review → Validate",
    description: "A small three-step loop for focused changes.",
  },
  {
    id: "staged",
    name: "Gated implementation and six reviews",
    description:
      "Evidence, planning, implementation, lint/type/coverage gates on the changed files, six read-only reviews, and final adjudication with one repair round.",
  },
];

const step = (
  id: string,
  name: string,
  stage: LoopDefinition["steps"][number]["stage"],
  role: string,
  instruction: string,
  expectedOutputs: string[],
  groupId?: string,
): LoopDefinition["steps"][number] => ({
  id,
  name,
  kind: "agent",
  stage,
  role,
  instruction,
  expectedOutputs,
  ...(groupId ? { groupId } : {}),
});

const edge = (from: string, to: string) => ({ from, to });

/** A check step running one changed-files gate inside the implementation round. */
const gate = (
  id: string,
  name: string,
  check: ChangedFilesGate,
  output: string,
): LoopDefinition["steps"][number] => ({
  id,
  name,
  kind: "check",
  stage: "validation",
  role: "Changed-files gate",
  instruction: changedFilesGateCommand(check),
  expectedOutputs: [output],
  groupId: "implementation-round",
});

const GATE_STEPS = ["gate-lint", "gate-types", "gate-coverage"];
/** The staged candidate passes every gate, then the diff check, before the reviews start. */
const GATE_CHAIN = ["candidate", ...GATE_STEPS, "diff-check"];
const REVIEWER_RULES =
  " You are read-only and cannot run commands: judge the code and the check receipts in your inputs (lint, types, coverage and diff checks of this candidate). Return blocked only when a receipt you need is missing.";

export const createStarterDraft = (starter: StarterId, id: string): LoopDefinition => {
  if (starter === "compact") {
    return parseLoop({
      schemaVersion: 2,
      id,
      name: "Implement → Review → Validate",
      version: 1,
      status: "draft",
      steps: [
        step(
          "implement",
          "Implement",
          "implementation",
          "Implementer",
          "Implement the requested change and explain the files changed.",
          ["Implementation and change summary"],
        ),
        step(
          "review",
          "Review",
          "review",
          "Reviewer",
          "Review the implementation against the request and identify concrete findings.",
          ["Review verdict and findings"],
        ),
        step(
          "validate",
          "Validate",
          "validation",
          "Validator",
          "Run relevant checks and report the results with evidence.",
          ["Validation receipts"],
        ),
      ],
      dependencies: [edge("implement", "review"), edge("review", "validate")],
      groups: [],
      joins: [],
      decisions: [],
      policy: { maxAttemptsPerStep: 3, maxImplementationRounds: 2 },
    });
  }
  return parseLoop({
    schemaVersion: 2,
    id,
    name: "Gated implementation and six reviews",
    version: 1,
    status: "draft",
    steps: [
      step(
        "requirements",
        "Requirements and baseline",
        "evidence",
        "Requirements analyst",
        "Identify the requested behavior, acceptance criteria, existing baseline, and relevant constraints.",
        ["Requirements and baseline evidence"],
      ),
      step(
        "domain-evidence",
        "Domain and API evidence",
        "evidence",
        "Domain analyst",
        "Inspect domain contracts, APIs, persistence, and runtime boundaries.",
        ["Domain and API findings"],
        "evidence-pair",
      ),
      step(
        "ui-evidence",
        "UI and test evidence",
        "evidence",
        "UI analyst",
        "Inspect user flows, accessibility, and existing tests.",
        ["UI and test findings"],
        "evidence-pair",
      ),
      step(
        "plan",
        "Design and plan",
        "planning",
        "Planner",
        "Combine both evidence streams into a concrete implementation and validation plan.",
        ["Implementation plan"],
      ),
      step(
        "implement",
        "Implement or repair",
        "implementation",
        "Implementer",
        `Implement the plan. On a repair round, address the adjudicated findings using the retained candidate and evidence. Before you finish, run the changed-files gates yourself (the command and the run's start commit are given below) and fix what fails: lint and type errors in changed files, and at least ${DEFAULT_COVERAGE_THRESHOLD}% line coverage from meaningful tests for every changed source file.`,
        ["Source changes and change summary"],
        "implementation-round",
      ),
      step(
        "candidate",
        "Stage candidate",
        "implementation",
        "Candidate steward",
        "Prepare a frozen candidate for checks and review. Record its identity and changed files.",
        ["Candidate identity and changed files"],
        "implementation-round",
      ),
      gate("gate-lint", "Lint changed files", "lint", "Lint receipt for the changed files"),
      gate("gate-types", "Type-check changed files", "types", "Type receipt for the changed files"),
      gate(
        "gate-coverage",
        `Coverage of changed files (${DEFAULT_COVERAGE_THRESHOLD}%)`,
        "coverage",
        "Line coverage receipt per changed source file",
      ),
      {
        id: "diff-check",
        name: "Verify candidate diff",
        kind: "check",
        stage: "validation",
        role: "Diff validator",
        instruction: "git diff --check HEAD",
        expectedOutputs: ["Check receipt for the staged candidate"],
        groupId: "implementation-round",
      },
      step(
        "quality-review",
        "Code quality review",
        "review",
        "Code quality reviewer",
        "Review the same candidate for correctness, architecture, readability, and maintainability." +
          REVIEWER_RULES,
        ["Quality verdict and findings"],
        "implementation-round",
      ),
      step(
        "react-review",
        "React and accessibility review",
        "review",
        "React and accessibility reviewer",
        "Review the same candidate for React behavior, interaction, and accessibility." +
          REVIEWER_RULES,
        ["React and accessibility verdict and findings"],
        "implementation-round",
      ),
      step(
        "performance-review",
        "Performance review",
        "review",
        "Performance reviewer",
        "Review the same candidate for performance and resource use." + REVIEWER_RULES,
        ["Performance verdict and findings"],
        "implementation-round",
      ),
      step(
        "security-review",
        "Security review",
        "review",
        "Security reviewer",
        "Review the same candidate for trust boundaries and security risks." + REVIEWER_RULES,
        ["Security verdict and findings"],
        "implementation-round",
      ),
      step(
        "acceptance-review",
        "Business acceptance review",
        "review",
        "Acceptance reviewer",
        "Review the same candidate against the requested business behavior and acceptance criteria." +
          REVIEWER_RULES,
        ["Acceptance verdict and findings"],
        "implementation-round",
      ),
      step(
        "test-review",
        "Test quality review",
        "review",
        "Test reviewer",
        "Review the same candidate for meaningful test coverage and validation evidence." +
          REVIEWER_RULES,
        ["Test verdict and findings"],
        "implementation-round",
      ),
      step(
        "adjudicate",
        "Verify and adjudicate",
        "validation",
        "Adjudicator",
        "Read all six review verdicts and check receipts for the same candidate. Return pass only when acceptance is met; otherwise return repair with concrete findings. A second repair decision rejects the run with evidence retained. The changed-files gates (lint, types, coverage) passed before the reviews ran; weigh the reviewers' findings.",
        ["Pass or repair decision with findings"],
        "implementation-round",
      ),
      step(
        "final-verification",
        "Final verification",
        "validation",
        "Final verifier",
        "Confirm the accepted candidate and record final validation and handoff evidence.",
        ["Final verification and handoff receipts"],
      ),
    ],
    dependencies: [
      edge("requirements", "domain-evidence"),
      edge("requirements", "ui-evidence"),
      edge("domain-evidence", "plan"),
      edge("ui-evidence", "plan"),
      edge("plan", "implement"),
      edge("implement", "candidate"),
      ...GATE_CHAIN.slice(1).map((to, index) => edge(GATE_CHAIN[index] ?? "", to)),
      ...[
        "quality-review",
        "react-review",
        "performance-review",
        "security-review",
        "acceptance-review",
        "test-review",
      ].map((id) => edge("diff-check", id)),
      ...[
        "quality-review",
        "react-review",
        "performance-review",
        "security-review",
        "acceptance-review",
        "test-review",
      ].map((id) => edge(id, "adjudicate")),
      edge("adjudicate", "final-verification"),
    ],
    groups: [
      {
        id: "evidence-pair",
        name: "Parallel evidence",
        kind: "parallel",
        stepIds: ["domain-evidence", "ui-evidence"],
      },
      {
        id: "implementation-round",
        name: "Implementation and three review pairs",
        kind: "repeat",
        stepIds: [
          "implement",
          "candidate",
          ...GATE_STEPS,
          "diff-check",
          "quality-review",
          "react-review",
          "performance-review",
          "security-review",
          "acceptance-review",
          "test-review",
          "adjudicate",
        ],
        maxIterations: 2,
        exitWhen: { stepId: "adjudicate", outcome: "pass" },
        continueWhen: { outcome: "repair", to: "implement" },
      },
    ],
    joins: [
      { stepId: "plan", mode: "all", from: ["domain-evidence", "ui-evidence"] },
      {
        stepId: "adjudicate",
        mode: "all",
        from: [
          "quality-review",
          "react-review",
          "performance-review",
          "security-review",
          "acceptance-review",
          "test-review",
        ],
      },
    ],
    decisions: [
      {
        stepId: "adjudicate",
        branches: [
          { outcome: "pass", to: "final-verification" },
          { outcome: "repair", to: "implement" },
        ],
      },
    ],
    policy: { maxAttemptsPerStep: 3, maxImplementationRounds: 2 },
  });
};
