import { createServer, type ViteDevServer } from "vite";
import { startLocalServer } from "../src/runtime/server.js";

let ui: ViteDevServer | undefined;
const runtime = await startLocalServer({
  projectDirectory: process.cwd(),
  port: 0,
  // Vite may choose the next free port; allow only the origin it actually bound.
  get devOrigin() {
    return ui?.resolvedUrls?.local[0]?.replace(/\/$/, "") ?? "http://127.0.0.1:4311";
  },
});

function closeRuntime() {
  return new Promise<void>((resolveClosed, reject) => {
    runtime.server.close((error) => (error ? reject(error) : resolveClosed()));
  });
}

try {
  ui = await createServer({ server: { proxy: { "/api": runtime.url } } });
  await ui.listen();
  ui.printUrls();
  console.log(`Local API: ${runtime.url} (proxied through the UI)`);
} catch (error) {
  await ui?.close();
  await closeRuntime();
  throw error;
}

let stopping = false;
async function stop() {
  if (stopping) return;
  stopping = true;
  await Promise.all([ui?.close(), closeRuntime()]);
}
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(
    signal,
    () =>
      void stop().catch((error: unknown) => {
        console.error(error instanceof Error ? error.message : "Development shutdown failed.");
        process.exitCode = 1;
      }),
  );
}
