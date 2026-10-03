import assert from "node:assert/strict";
import { test } from "node:test";
import { MAX_SESSION_MILLISECONDS, parseSessionDuration } from "../scripts/symphony/session.mjs";

test("session duration is unlimited when unset", () => {
  assert.equal(parseSessionDuration(undefined), null);
});

test("explicit duration must be positive, finite, and within Node timer bounds", () => {
  assert.equal(parseSessionDuration("15"), 15);
  assert.equal(parseSessionDuration("0.5"), 0.5);
  assert.equal(
    parseSessionDuration(String(MAX_SESSION_MILLISECONDS / 60_000)),
    MAX_SESSION_MILLISECONDS / 60_000,
  );
  for (const value of ["", "0", "-1", "NaN", "Infinity", "35791.4", "abc"]) {
    assert.throws(() => parseSessionDuration(value), /SYMPHONY_RUN_MINUTES/);
  }
});
