import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

const configDir = path.dirname(fileURLToPath(import.meta.url));
const appsRoot = path.resolve(configDir, "..");

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(appsRoot, "frontend"),
    },
  },
});
