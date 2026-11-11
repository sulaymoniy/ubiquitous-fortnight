import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../../', import.meta.url));
export default defineConfig({
  root,
  server: { fs: { allow: [root] } },
  plugins: [react()],
  test: {
    environment: 'jsdom',
    include: ['tests/web/**/*.test.{ts,tsx}'],
    setupFiles: ['tests/web/setup.ts'],
    restoreMocks: true,
  },
});
