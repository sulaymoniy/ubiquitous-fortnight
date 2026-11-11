import { defineConfig, devices } from '@playwright/test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
export default defineConfig({
  testDir: '.', testMatch: '*.spec.ts', fullyParallel: false,
  forbidOnly: Boolean(process.env.CI), retries: process.env.CI ? 2 : 0,
  reporter: 'list', outputDir: path.join(root, 'src/web/node_modules/.cache/playwright-results'),
  use: { baseURL: 'http://127.0.0.1:5173', trace: 'retain-on-failure' },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: [
    { command: 'npm run dev --workspace @fortnight/server', cwd: root, url: 'http://127.0.0.1:3001/api/health', reuseExistingServer: !process.env.CI, env: { AGENT_FAKE: '1', ANTHROPIC_API_KEY: '' } },
    { command: 'npm run dev --workspace @fortnight/web', cwd: root, url: 'http://127.0.0.1:5173', reuseExistingServer: !process.env.CI },
  ],
});
