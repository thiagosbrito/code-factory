// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { chapters, resolveChapterLink } from "../src/ui/features/manual/chapters.js";
import { headingIds } from "../src/ui/features/manual/ManualMarkdown.js";
import { Manual } from "../src/ui/features/manual/Manual.js";
import { FactorySidebar } from "../src/ui/factory/FactorySidebar.js";

afterEach(cleanup);

describe("manual content", () => {
  it("has numbered chapters, each with one title and no raw HTML", () => {
    expect(chapters.length).toBeGreaterThanOrEqual(8);
    expect(chapters.map((chapter) => chapter.file)).toEqual(
      chapters.map((chapter) => chapter.file).sort(),
    );
    const problems = chapters.flatMap((chapter) => [
      ...((chapter.body.match(/^# /gm) ?? []).length === 1
        ? []
        : [`${chapter.file}: needs one title`]),
      ...(/<\/?(script|iframe|div|span|img)\b/i.test(chapter.body)
        ? [`${chapter.file}: raw HTML`]
        : []),
    ]);
    expect(problems).toEqual([]);
  });

  it("only links to chapters that exist", () => {
    const broken = chapters.flatMap((chapter) =>
      [...chapter.body.matchAll(/\]\(([^)\s]+\.md[^)\s]*)\)/g)]
        .map((match) => match[1] ?? "")
        .filter((href) => !resolveChapterLink(href))
        .map((href) => `${chapter.file} -> ${href}`),
    );
    expect(broken).toEqual([]);
  });

  it("gives repeated headings distinct anchors and skips fenced code", () => {
    const ids = headingIds(
      "# T\n\n## What changes\n\n```\n## not a heading\n```\n\n## What changes\n",
    );
    expect([...ids.values()]).toEqual(["what-changes", "what-changes-2"]);
  });
});

describe("manual screen", () => {
  it("lists the chapters, opens one, and filters by search", async () => {
    const user = userEvent.setup();
    render(<Manual />);
    const list = screen.getByRole("navigation", { name: "Manual chapters" });
    expect(within(list).getAllByRole("button")).toHaveLength(chapters.length);
    const second = chapters[1];
    if (!second) throw new Error("expected a second chapter");
    await user.click(within(list).getByRole("button", { name: second.title }));
    expect(screen.getByRole("article", { name: second.title })).toBeTruthy();
    expect(
      within(list).getByRole("button", { name: second.title }).getAttribute("aria-current"),
    ).toBe("page");
    await user.type(
      screen.getByRole("searchbox", { name: "Search the manual" }),
      "zzzz-no-such-term",
    );
    expect(screen.getByText(/No chapter mentions/)).toBeTruthy();
  });

  it("moves between chapters with Next and Previous", async () => {
    const user = userEvent.setup();
    render(<Manual />);
    await user.click(screen.getByRole("button", { name: /Next/ }));
    expect(screen.getByRole("article", { name: chapters[1]?.title ?? "" })).toBeTruthy();
    await user.click(screen.getByRole("button", { name: /Previous/ }));
    expect(screen.getByRole("article", { name: chapters[0]?.title ?? "" })).toBeTruthy();
  });
});

describe("sidebar manual link", () => {
  it("opens the manual from the bottom of the sidebar", async () => {
    const user = userEvent.setup();
    const opened: string[] = [];
    render(
      <FactorySidebar
        projectName="P"
        screen="runs"
        setScreen={(screen) => opened.push(screen)}
        runs={0}
        demo={false}
        onExitDemo={() => {}}
        collapsed={false}
        onToggleCollapsed={() => {}}
      />,
    );
    await user.click(screen.getByRole("button", { name: "User manual" }));
    expect(opened).toEqual(["manual"]);
  });

  it("keeps the link, as an icon, in the collapsed rail", () => {
    render(
      <FactorySidebar
        projectName="P"
        screen="manual"
        setScreen={() => {}}
        runs={0}
        demo={false}
        onExitDemo={() => {}}
        collapsed
        onToggleCollapsed={() => {}}
      />,
    );
    expect(screen.getByRole("button", { name: "User manual" }).getAttribute("aria-current")).toBe(
      "page",
    );
  });
});
