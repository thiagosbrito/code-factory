export const MAX_SESSION_MILLISECONDS = 2_147_483_647;

export function parseSessionDuration(value) {
  if (value === undefined) return null;
  const minutes = Number(value);
  const maxMinutes = MAX_SESSION_MILLISECONDS / 60_000;
  if (!Number.isFinite(minutes) || minutes <= 0 || minutes > maxMinutes) {
    throw new Error(
      "SYMPHONY_RUN_MINUTES must be a positive finite duration supported by Node timers.",
    );
  }
  return minutes;
}
