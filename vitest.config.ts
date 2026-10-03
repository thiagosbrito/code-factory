import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: { alias: { "@": fileURLToPath(new URL("./src/ui", import.meta.url)) } },
  test: { environment: "node", include: ["tests/**/*.test.{ts,tsx}"], maxWorkers: 2 },
});
