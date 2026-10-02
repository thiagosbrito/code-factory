import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: { alias: { "@": fileURLToPath(new URL("./src/ui", import.meta.url)) } },
  server: {
    host: "127.0.0.1",
    port: 4311,
    strictPort: false,
    proxy: { "/api": "http://127.0.0.1:4310" },
  },
  build: { outDir: "dist/ui" },
});
