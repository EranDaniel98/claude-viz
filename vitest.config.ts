import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    // web/ has its own package.json, so npm installs a second copy of react
    // under web/node_modules. Two React copies → "Cannot read useState of null"
    // because hooks check identity against a single dispatcher. Dedupe forces
    // one copy across the test process.
    dedupe: ["react", "react-dom"],
  },
  test: {
    globals: false,
    include: ["tests/**/*.test.ts", "tests/**/*.test.tsx"],
    // Node is the default for server/state tests. Component tests opt in
    // via `// @vitest-environment jsdom` at the top of the file.
    environment: "node",
    setupFiles: ["tests/setup.ts"],
  },
});
