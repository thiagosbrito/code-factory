// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { LoopDefinition } from "../src/domain/loop.js";
import { disconnectAction } from "../src/ui/features/loops/graph/graph-actions.js";
import { useConfirmedChange } from "../src/ui/features/loops/graph/useConfirmedChange.js";
import { joined, parallel } from "./support/loop-editor-builders.js";

const setup = (initial: LoopDefinition) => {
  const apply = vi.fn<() => boolean>(() => true);
  const restore = vi.fn<() => void>();
  const hook = renderHook(({ loop }) => useConfirmedChange(loop, apply, restore), {
    initialProps: { loop: initial },
  });
  const edges = [{ source: "b", target: "d" }];
  const propose = (loop: LoopDefinition) =>
    act(() => {
      hook.result.current.propose(loop, disconnectAction(edges), { kind: "disconnect", edges });
    });
  return { hook, apply, propose };
};

describe("pending confirmation", () => {
  it("holds a warned change until it is confirmed, then applies it once", () => {
    const loop = joined();
    const { hook, apply, propose } = setup(loop);
    propose(loop);
    expect(hook.result.current.warnings?.[0]).toContain("fewer than two sources");
    expect(apply).not.toHaveBeenCalled();
    act(() => hook.result.current.confirm());
    expect(apply).toHaveBeenCalledTimes(1);
    expect(hook.result.current.warnings).toBeNull();
  });

  it("is dropped when the loop changes and does not come back when the same loop returns", () => {
    const loop = joined();
    const { hook, apply, propose } = setup(loop);
    propose(loop);
    expect(hook.result.current.warnings).not.toBeNull();
    // Undo to another loop, then Redo back to the very same reference.
    hook.rerender({ loop: parallel() });
    expect(hook.result.current.warnings).toBeNull();
    hook.rerender({ loop });
    expect(hook.result.current.warnings).toBeNull();
    act(() => hook.result.current.confirm());
    expect(apply).not.toHaveBeenCalled();
  });
});
