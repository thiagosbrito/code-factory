import { ChildProcess } from "node:child_process";
import { afterEach, describe, expect, it, vi } from "vitest";
import { terminateChild } from "../src/adapters/process.js";

afterEach(() => vi.restoreAllMocks());

const childWithPid = () => {
  const child = new ChildProcess();
  Object.defineProperty(child, "pid", { value: 12345 });
  return child;
};

describe("adapter process termination", () => {
  it("does nothing when spawning has not assigned a PID", () => {
    const group = vi.spyOn(process, "kill");
    const child = new ChildProcess();
    const direct = vi.spyOn(child, "kill");
    terminateChild(child);
    expect(group).not.toHaveBeenCalled();
    expect(direct).not.toHaveBeenCalled();
  });

  it.runIf(process.platform === "win32")("terminates the owned Windows child", () => {
    const child = childWithPid();
    const group = vi.spyOn(process, "kill");
    const direct = vi.spyOn(child, "kill").mockReturnValue(true);
    terminateChild(child);
    expect(direct).toHaveBeenCalledOnce();
    expect(group).not.toHaveBeenCalled();
  });

  describe.runIf(process.platform !== "win32")("POSIX process groups", () => {
    it("signals the whole group when allowed", () => {
      const child = childWithPid();
      const group = vi.spyOn(process, "kill").mockReturnValue(true);
      const direct = vi.spyOn(child, "kill");
      terminateChild(child);
      expect(group).toHaveBeenCalledWith(-12345, "SIGTERM");
      expect(direct).not.toHaveBeenCalled();
    });

    it("ignores a group that has already exited", () => {
      const child = childWithPid();
      vi.spyOn(process, "kill").mockImplementation(() => {
        throw Object.assign(new Error("kill ESRCH"), { code: "ESRCH" });
      });
      const direct = vi.spyOn(child, "kill");
      expect(() => terminateChild(child)).not.toThrow();
      expect(direct).not.toHaveBeenCalled();
    });

    it("falls back to the child handle when the group signal is denied", () => {
      const child = childWithPid();
      vi.spyOn(process, "kill").mockImplementation(() => {
        throw Object.assign(new Error("kill EPERM"), { code: "EPERM" });
      });
      const direct = vi.spyOn(child, "kill").mockReturnValue(false);
      // A false return is also valid: the child can have exited before cleanup.
      expect(() => terminateChild(child)).not.toThrow();
      expect(direct).toHaveBeenCalledWith("SIGTERM");
    });

    it("preserves unexpected signal failures", () => {
      const failure = Object.assign(new Error("kill EINVAL"), { code: "EINVAL" });
      vi.spyOn(process, "kill").mockImplementation(() => {
        throw failure;
      });
      expect(() => terminateChild(childWithPid())).toThrow(failure);
    });
  });
});
