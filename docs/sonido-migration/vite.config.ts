// The migration preview: the app's real CSS plus the Sonido components, served at
// http://localhost:5312/docs/sonido-migration/preview.html. Not part of the app build.
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

export default defineConfig({
  root: fileURLToPath(new URL("../..", import.meta.url)),
  plugins: [react()],
  logLevel: "error",
  server: { port: 5312, strictPort: true },
});
