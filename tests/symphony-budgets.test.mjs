import assert from "node:assert/strict";
import test from "node:test";
import { budgetArguments } from "../scripts/symphony/budgets.mjs";
test("worker limits are finite and configurable without changing its model", () => {
  assert.deepEqual(budgetArguments(), [
    "-c",
    "tool_output_token_limit=2000",
    "-c",
    "model_auto_compact_token_limit=40000",
  ]);
  assert.ok(
    budgetArguments({ SYMPHONY_COMPACT_TOKENS: "32000" }).includes(
      "model_auto_compact_token_limit=32000",
    ),
  );
  for (const invalid of ["0", "Infinity", "NaN", "999999999", "12.5"])
    assert.throws(() => budgetArguments({ SYMPHONY_COMPACT_TOKENS: invalid }));
});
