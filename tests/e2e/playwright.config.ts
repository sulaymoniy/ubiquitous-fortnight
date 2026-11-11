import { defineConfig, devices } from '@playwright/test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const dataDir = path.join(root, 'src/web/node_modules/.cache/e2e-data', String(Date.now()));
export default defineConfig({
  testDir: '.',
  testMatch: '*.spec.ts',
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  reporter: 'list',
  outputDir: path.join(root, 'src/web/node_modules/.cache/playwright-results'),
  use: { baseURL: 'http://127.0.0.1:5174', trace: 'retain-on-failure' },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: [
    {
      command: 'npm run dev --workspace @fortnight/server',
      cwd: root,
      url: 'http://127.0.0.1:3101/api/health',
      reuseExistingServer: false,
      env: {
        HOST: '127.0.0.1',
        PORT: '3101',
        DATA_DIR: dataDir,
        DB_FILE: path.join(dataDir, 'fortnight.db'),
        LOG_LEVEL: 'silent',
        AGENT_FAKE: '1',
        ANTHROPIC_API_KEY: '',
      },
    },
    {
      command: 'npm run dev --workspace @fortnight/web -- --port 5174',
      cwd: root,
      url: 'http://127.0.0.1:5174',
      reuseExistingServer: false,
      env: { FORTNIGHT_API_TARGET: 'http://127.0.0.1:3101' },
    },
  ],
});
