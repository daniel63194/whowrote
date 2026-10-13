import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // The CLI tests start git and node many times; process start-up is slow on Windows runners.
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
});
