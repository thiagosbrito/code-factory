// @vitest-environment jsdom
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { EvidenceSummary } from "../src/domain/acceptance.js";
import { Markdown } from "../src/ui/shared/Markdown.js";
import { RunEvidenceSummary } from "../src/ui/features/runs/RunEvidenceSummary.js";

afterEach(cleanup);

describe("Markdown", () => {
  it("formats agent text and never renders raw HTML from it", () => {
    const { container } = render(
      <Markdown>
        {[
          "**Cost:** serialization runs only on click, inside `handleExport`.",
          "",
          "- one",
          "- two",
          "",
          "| Gate | Result |",
          "| --- | --- |",
          "| Lint | passed |",
          "",
          '<img src="x" onerror="alert(1)"> [docs](https://example.com)',
        ].join("\n")}
      </Markdown>,
    );
    expect(screen.getByText("Cost:").tagName).toBe("STRONG");
    expect(screen.getByText("handleExport").tagName).toBe("CODE");
    expect(screen.getAllByRole("listitem").map((item) => item.textContent)).toEqual(["one", "two"]);
    expect(screen.getByRole("table")).toBeTruthy();
    expect(container.querySelector("img")).toBeNull();
    const link = screen.getByRole("link", { name: "docs" });
    expect(link.getAttribute("target")).toBe("_blank");
    expect(link.getAttribute("rel")).toBe("noopener noreferrer");
  });

  it("shows review findings formatted and grouped by review in the evidence summary", () => {
    const summary: EvidenceSummary = {
      validation: "passed",
      acceptance: "pending",
      requirements: [],
      findings: ["Nothing blocking.", "- **Cost:** trivial"],
      reviews: [
        {
          stepId: "performance-review",
          name: "Performance review",
          verdict: "pass",
          findings: ["Nothing blocking.", "- **Cost:** trivial"],
        },
      ],
      gaps: [],
      files: [],
      artifacts: [],
      signature: "s",
    };
    render(
      <RunEvidenceSummary
        summary={summary}
        complete={18}
        total={18}
        onOpenFiles={vi.fn<() => void>()}
        onOpenArtifacts={vi.fn<() => void>()}
      />,
    );
    const review = screen.getByText("Performance review").closest("li");
    if (!review) throw new Error("Missing review group");
    expect(within(review).getByText("pass")).toBeTruthy();
    expect(within(review).getByText("Cost:").tagName).toBe("STRONG");
    expect(within(review).queryByText(/\*\*/)).toBeNull();
  });
});
