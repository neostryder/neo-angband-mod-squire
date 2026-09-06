/**
 * Test config, whose one job is to say what a test file is.
 *
 * There is deliberately no engine alias here and no setup file. The decision
 * code takes everything it needs through its own context object, so a test
 * builds a world by describing one rather than by booting a game, and nothing
 * under test imports the engine at run time - the only engine imports in this
 * repository are `import type`, which the compiler erases.
 *
 * The explicit `include` is not decoration. `tools/build.mjs` writes plugin.js
 * beside the manifest and a future build step could write more beside it;
 * naming the two source locations means a collected test is always a file
 * somebody wrote, never a bundled copy of one.
 */

import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["*.test.ts", "src/**/*.test.ts"],
  },
});
