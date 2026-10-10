import { vi } from "vitest";

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}

class DOMMatrixReadOnlyStub {
  m22: number;
  constructor(transform?: string) {
    const scale = transform?.match(/scale\(([\d.]+)\)/)?.[1];
    this.m22 = scale === undefined ? 1 : Number(scale);
  }
}

/**
 * jsdom has no ResizeObserver or DOMMatrix, which React Flow needs. The Graph view declares each
 * node's size and handles itself, so edges render without layout. Pair with `vi.unstubAllGlobals()`.
 */
export const stubReactFlowGlobals = (): void => {
  vi.stubGlobal("ResizeObserver", ResizeObserverStub);
  vi.stubGlobal("DOMMatrixReadOnly", DOMMatrixReadOnlyStub);
};
