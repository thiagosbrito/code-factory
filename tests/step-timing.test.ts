import { describe, expect, it } from "vitest";
import {
  formatDuration,
  hasRunningAttempt,
  stepElapsedMs,
} from "../src/ui/features/runs/step-timing.js";
import type { RunStep } from "../src/ui/features/runs/run-view-model.js";

type Attempt = RunStep["attempts"][number];

const attempt = (status: Attempt["status"], startedAt: string, endedAt?: string): Attempt => ({
  id: crypto.randomUUID(),
  number: 1,
  implementationRound: 1,
  status,
  startedAt,
  ...(endedAt ? { endedAt } : {}),
});

const step = (...attempts: Attempt[]): RunStep => ({
  id: crypto.randomUUID(),
  stepId: "a",
  status: "running",
  attempts,
});

const at = (iso: string) => Date.parse(iso);

describe("step elapsed time", () => {
  it("is null before the first attempt", () => {
    expect(stepElapsedMs(undefined, 0)).toBeNull();
    expect(stepElapsedMs(step(), 0)).toBeNull();
  });

  it("counts a running attempt up to now", () => {
    const running = step(attempt("running", "2026-10-10T10:00:00.000Z"));
    expect(stepElapsedMs(running, at("2026-10-10T10:03:12.000Z"))).toBe(192_000);
  });

  it("sums ended attempts and a running retry", () => {
    const retried = step(
      attempt("failed", "2026-10-10T10:00:00.000Z", "2026-10-10T10:01:00.000Z"),
      attempt("running", "2026-10-10T10:02:00.000Z"),
    );
    expect(stepElapsedMs(retried, at("2026-10-10T10:02:30.000Z"))).toBe(90_000);
  });

  it("is unknown, not zero, while an attempt is paused, waiting or interrupted with no end time", () => {
    for (const status of ["paused", "waiting-input", "interrupted"] as const) {
      const stuck = step(
        attempt("succeeded", "2026-10-10T09:00:00.000Z", "2026-10-10T09:05:00.000Z"),
        attempt(status, "2026-10-10T10:00:00.000Z"),
      );
      expect(stepElapsedMs(stuck, at("2026-10-10T12:00:00.000Z"))).toBeNull();
    }
  });

  it("never goes negative when the clock is behind the recorded start", () => {
    const early = step(attempt("running", "2026-10-10T10:00:10.000Z"));
    expect(stepElapsedMs(early, at("2026-10-10T10:00:00.000Z"))).toBe(0);
  });

  it("reports whether any attempt is running", () => {
    const done = step(attempt("succeeded", "2026-10-10T10:00:00.000Z", "2026-10-10T10:00:05.000Z"));
    const live = step(attempt("running", "2026-10-10T10:00:00.000Z"));
    expect(hasRunningAttempt([done])).toBe(false);
    expect(hasRunningAttempt([done, live])).toBe(true);
  });
});

describe("formatDuration", () => {
  it("shows seconds, minutes with seconds, then hours with minutes", () => {
    expect(formatDuration(0)).toBe("0s");
    expect(formatDuration(42_900)).toBe("42s");
    expect(formatDuration(192_000)).toBe("3m 12s");
    expect(formatDuration(3_840_000)).toBe("1h 04m");
  });
});
