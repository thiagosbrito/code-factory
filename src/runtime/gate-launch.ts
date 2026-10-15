/**
 * Plain-JavaScript counterpart of `planLaunch` in `src/adapters/launch.ts`, embedded in the
 * changed-files gate because that script ships into projects and cannot import Code Factory.
 * A test compares both planners so they cannot drift. It avoids template literals and backticks
 * (the gate source is itself a template literal).
 */
export const GATE_LAUNCH_SOURCE = String.raw`const LAUNCHABLE = [".exe", ".cmd", ".bat"]
const CMD_META = /([()\][%!^"\x60<>&|;, *?])/g
const resolveGateBin = (path, platform, exists) => {
  if (platform !== "win32" || !/[\\/]/.test(path)) return path
  if (LAUNCHABLE.some(extension => path.toLowerCase().endsWith(extension))) return path
  return LAUNCHABLE.map(extension => path + extension).find(exists) || path
}
const escapeGateArgument = (value, doubleEscape) => {
  const quoted = '"' + value.replace(/(\\*)"/g, '$1$1\\"').replace(/(\\+)$/, "$1$1") + '"'
  const once = quoted.replace(CMD_META, "^$1")
  return doubleEscape ? once.replace(CMD_META, "^$1") : once
}
// Node cannot spawn .cmd/.bat directly, so Windows command scripts run through cmd.exe with every
// metacharacter escaped; arguments cmd.exe would truncate are refused.
const planGateLaunch = (path, args, platform, exists, comspec) => {
  if (platform !== "win32") return { command: path, args, verbatim: false }
  const resolved = resolveGateBin(path, platform, exists)
  if (!/\.(cmd|bat)$/i.test(resolved)) return { command: resolved, args, verbatim: false }
  for (const value of [resolved, ...args])
    if (/[\r\n\0]/.test(value)) throw new Error(resolved + " is a Windows command script and cannot receive an argument with a line break.")
  if (!exists(resolved)) {
    const missing = new Error(resolved + " was not found")
    missing.code = "ENOENT"
    throw missing
  }
  const doubleEscape = /\.cmd$/i.test(resolved)
  const line = [resolved.replace(CMD_META, "^$1"), ...args.map(value => escapeGateArgument(value, doubleEscape))].join(" ")
  if (comspec.length + line.length + 12 > 8191)
    throw new Error("The command line for " + resolved + " would exceed the 8191 characters cmd.exe accepts; too many changed files for this tool.")
  return { command: comspec, args: ["/d", "/s", "/c", '"' + line + '"'], verbatim: true }
}
`;
