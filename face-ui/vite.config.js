import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  root: __dirname,
  base: "/face-verify/",
  plugins: [react()],
  build: {
    outDir: path.resolve(__dirname, "../public/face-verify"),
    emptyOutDir: true
  }
});