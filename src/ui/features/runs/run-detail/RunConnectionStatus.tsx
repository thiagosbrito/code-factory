/** Whether the runtime is reachable and how run events arrive. */
export const RunConnectionStatus = ({
  connected,
  streamConnected,
}: {
  connected: boolean;
  streamConnected?: boolean | null | undefined;
}) => (
  <span className={connected && streamConnected !== false ? "text-emerald-700" : "text-red-700"}>
    {!connected
      ? "Disconnected · work state unknown"
      : streamConnected === false
        ? "Event stream reconnecting · runtime reachable"
        : streamConnected === true
          ? "Live event stream"
          : "Runtime reachable · polling"}
  </span>
);
