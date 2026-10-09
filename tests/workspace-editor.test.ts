// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import {
  openInEditorCommand,
  saveEditor,
  storedEditor,
} from "../src/ui/features/runs/run-workspace/workspace-editor.js";

afterEach(() => {
  vi.restoreAllMocks();
  window.localStorage.clear();
});

it("remembers the chosen editor and defaults to VS Code", () => {
  expect(storedEditor()).toBe("code");
  saveEditor("cursor");
  expect(storedEditor()).toBe("cursor");
  window.localStorage.setItem("code-factory.editor-command", "not-an-editor");
  expect(storedEditor()).toBe("code");
});

it("keeps working when storage is unavailable", () => {
  vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
    throw new Error("blocked");
  });
  vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
    throw new Error("blocked");
  });
  expect(storedEditor()).toBe("code");
  expect(() => saveEditor("kiro")).not.toThrow();
});

it("quotes the path in the open-in-editor command", () => {
  expect(openInEditorCommand("code", "/tmp/my project")).toBe("code -n '/tmp/my project'");
});
