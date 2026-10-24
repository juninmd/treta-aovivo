// The real UI with the Tauri bindings swapped for the scripted demo (README screenshots only).
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

const here = (p: string) => fileURLToPath(new URL(p, import.meta.url));

export default defineConfig({
  root: here("../.."),
  plugins: [react()],
  logLevel: "error",
  resolve: {
    alias: [
      { find: /^@tauri-apps\/api\/core$/, replacement: here("./mock/core.ts") },
      { find: /^@tauri-apps\/plugin-http$/, replacement: here("./mock/http.ts") },
      { find: /^@tauri-apps\/plugin-opener$/, replacement: here("./mock/opener.ts") },
    ],
  },
  server: { port: 1430, strictPort: true },
});
