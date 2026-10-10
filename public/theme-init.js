// Applies the saved or system theme before first paint. It is an external file, not an inline
// script, because the runtime's Content-Security-Policy is `script-src 'self'`. Keep the storage
// key and the resolution order in step with src/ui/shared/theme.ts (tests/theme.test.ts checks it).
try {
  var theme = localStorage.getItem("code-factory:theme");
  if (
    theme === "dark" ||
    (theme !== "light" && matchMedia("(prefers-color-scheme: dark)").matches)
  ) {
    document.documentElement.classList.add("dark");
  }
} catch {
  // Blocked storage or no matchMedia: stay light.
}
