// Limits apply to newly launched workers; they never interrupt an active turn.
function limit(environment, name, fallback, maximum) {
  const value = environment[name] === undefined ? fallback : Number(environment[name]);
  if (!Number.isSafeInteger(value) || value < 256 || value > maximum)
    throw new Error(`${name} must be an integer between 256 and ${maximum}.`);
  return value;
}
export function budgetArguments(environment = {}) {
  return [
    "-c",
    `tool_output_token_limit=${limit(environment, "SYMPHONY_TOOL_OUTPUT_TOKENS", 2000, 10000)}`,
    "-c",
    `model_auto_compact_token_limit=${limit(environment, "SYMPHONY_COMPACT_TOKENS", 40000, 100000)}`,
  ];
}
