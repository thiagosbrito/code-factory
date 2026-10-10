// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  loopEditorViewStorageKey,
  readLoopEditorView,
  writeLoopEditorView,
} from "../src/ui/features/loops/loop-editor-view";

beforeEach(() => window.localStorage.clear());
afterEach(() => vi.restoreAllMocks());

describe("loop editor view preference", () => {
  it("defaults to the Board and remembers a valid choice", () => {
    expect(readLoopEditorView()).toBe("board");
    writeLoopEditorView("graph");
    expect(window.localStorage.getItem(loopEditorViewStorageKey)).toBe("graph");
    expect(readLoopEditorView()).toBe("graph");
    writeLoopEditorView("board");
    expect(readLoopEditorView()).toBe("board");
  });

  it("ignores unknown stored values", () => {
    window.localStorage.setItem(loopEditorViewStorageKey, "hologram");
    expect(readLoopEditorView()).toBe("board");
  });

  it("falls back to the Board and does not throw when storage is blocked", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    expect(readLoopEditorView()).toBe("board");
    expect(() => writeLoopEditorView("graph")).not.toThrow();
  });
});
