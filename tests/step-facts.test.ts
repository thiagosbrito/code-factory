import { describe, expect, it } from "vitest";
import type { AgentConnection } from "../src/adapters/contract.js";
import { NOT_CONFIGURED, stepFacts } from "../src/ui/shared/step-facts.js";

const claude = {
  provider: "claude-code",
  models: [{ id: "opus", displayName: "Claude Opus", efforts: ["low", "high"] }],
} as unknown as AgentConnection;

describe("step card facts", () => {
  it("names the agent, the model's display name and the effort", () => {
    expect(
      stepFacts({
        binding: { provider: "claude-code", model: "opus", effort: "high" },
        projectDefault: null,
        agents: [claude],
      }),
    ).toEqual({
      agent: "Claude Code",
      model: "Claude Opus",
      effort: "High",
      effortScale: { position: 2, total: 2 },
      inherited: false,
    });
  });

  it("falls back to the model id when the adapter does not list it, and says Default effort", () => {
    const facts = stepFacts({
      binding: { provider: "claude-code", model: "legacy-model" },
      projectDefault: null,
      agents: [claude],
    });
    expect(facts.model).toBe("legacy-model");
    expect(facts.effort).toBe("Default");
  });

  it("writes Agent default for the agent-default model", () => {
    expect(
      stepFacts({
        binding: { provider: "codex", model: "agent-default" },
        projectDefault: null,
        agents: [],
      }).model,
    ).toBe("Agent default");
  });

  it("uses the project default for a step without a binding and marks it inherited", () => {
    const facts = stepFacts({
      binding: undefined,
      projectDefault: { provider: "codex", model: "agent-default" },
      agents: [],
    });
    expect(facts).toMatchObject({ agent: "Codex", inherited: true });
  });

  it("never guesses: with no binding and no default every fact is Not configured", () => {
    expect(stepFacts({ binding: null, projectDefault: null, agents: [] })).toEqual({
      agent: NOT_CONFIGURED,
      model: NOT_CONFIGURED,
      effort: NOT_CONFIGURED,
      effortScale: null,
      inherited: true,
    });
  });

  it("draws no meter for a saved effort the model no longer offers, and none for Default", () => {
    const stale = stepFacts({
      binding: { provider: "claude-code", model: "opus", effort: "max" },
      projectDefault: null,
      agents: [claude],
    });
    expect(stale.effortScale).toBeNull();
    const unset = stepFacts({
      binding: { provider: "claude-code", model: "opus" },
      projectDefault: null,
      agents: [claude],
    });
    expect(unset.effortScale).toEqual({ position: 0, total: 2 });
  });
});
