/** First still-mounted target: a dialog's trigger unmounts once its action succeeds. */
export const firstConnected = (...targets: (HTMLElement | null)[]): HTMLElement | null =>
  targets.find((target) => target?.isConnected) ?? null;
