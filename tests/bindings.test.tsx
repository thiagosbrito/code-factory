// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import type { AgentConnection } from "../src/adapters/contract.js";
import type { ExecutionBinding } from "../src/domain/loop.js";
import { StepBindingSelectors } from "../src/ui/shared/StepBindingSelectors.js";

afterEach(cleanup);
const codex: AgentConnection = {
  provider: "codex",
  executable: "/bin/codex",
  installation: "detected",
  identity: "Codex CLI",
  version: "0.160.0",
  protocol: "Codex app-server",
  authentication: "authenticated",
  capabilities: {
    streaming: "unknown",
    steering: "unknown",
    resume: "unknown",
    pause: "unsupported",
    waitingInput: "unknown",
  },
  models: [{ id: "model-a", displayName: "Model A", efforts: ["low"] }],
};
const cursor: AgentConnection = {
  provider: "cursor",
  executable: null,
  installation: "missing",
  authentication: "unknown",
  capabilities: {
    streaming: "unknown",
    steering: "unknown",
    resume: "unknown",
    pause: "unsupported",
    waitingInput: "unknown",
  },
};

describe("step binding selectors", () => {
  it("supports keyboard selection, inheritance, and clearing incompatible model and effort", async () => {
    const user = userEvent.setup();
    function View() {
      const [binding, setBinding] = useState<ExecutionBinding | null>(null);
      return (
        <StepBindingSelectors
          value={binding}
          onChange={setBinding}
          agents={[codex, cursor]}
          projectDefault={{ provider: "codex", model: "model-a" }}
        />
      );
    }
    render(<View />);
    const agent = screen.getByRole("combobox", { name: "Step coding agent" });
    agent.focus();
    await user.selectOptions(agent, "codex");
    await user.selectOptions(screen.getByRole("combobox", { name: "Step model" }), "model-a");
    fireEvent.change(screen.getByRole("slider", { name: "Step effort" }), {
      target: { value: "1" },
    });
    await user.selectOptions(agent, "cursor");
    expect(screen.getByRole("combobox", { name: "Step model" })).toHaveProperty(
      "value",
      "agent-default",
    );
    expect(screen.getByRole("slider", { name: "Step effort" })).toHaveProperty("value", "0");
    expect(screen.getByRole("alert").textContent).toContain("unavailable");
    await user.selectOptions(agent, "");
    // An inheriting step still shows the model it inherits and lets the user override it.
    expect(screen.getByRole("combobox", { name: "Step model" })).toHaveProperty("value", "model-a");
    expect(screen.getByRole("option", { name: /Inherit project default/ })).toBeTruthy();
  });
  it("keeps a saved model visible when the adapter catalog removes it", () => {
    render(
      <StepBindingSelectors
        value={{ provider: "codex", model: "old-model" }}
        onChange={() => {}}
        agents={[codex]}
        projectDefault={null}
      />,
    );
    expect(screen.getByRole("option", { name: "old-model (unavailable)" })).toBeTruthy();
    expect(screen.getByRole("alert").textContent).toContain("old-model");
  });
});
