import { defineConfig } from 'vitest/config';

// Server-side tests live outside the package (tests/server, tests/contract) per plan section 3.
export default defineConfig({
  test: {
    dir: '../../tests',
    include: ['server/**/*.test.ts', 'contract/**/*.test.ts'],
    environment: 'node',
    pool: 'forks',
  },
});
