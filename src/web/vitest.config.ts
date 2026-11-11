import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";
import path from "node:path";
const web = path.dirname(fileURLToPath(import.meta.url));
export default defineConfig({
  root: path.resolve(web, "../.."),
  server: { fs: { allow: [path.resolve(web, "../..")] } },
  plugins: [react()],
  resolve: {
    alias: Object.fromEntries(
      [
        "react",
        "react-dom",
        "@tanstack/react-query",
        "@testing-library/react",
        "@testing-library/user-event",
        "@testing-library/jest-dom",
        "vitest",
        "zustand",
      ].map((name) => [name, path.resolve(web, "node_modules", name)]),
    ),
  },
  test: {
    environment: "jsdom",
    include: ["tests/web/**/*.test.{ts,tsx}"],
    setupFiles: ["tests/web/setup.ts"],
    restoreMocks: true,
  },
});
