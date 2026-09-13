import { defineConfig } from '@playwright/test'

// Separate servers and data: running this suite never resets a developer's mock.
export default defineConfig({
  testDir: './tests',
  testMatch: '**/backend-mockup.spec.ts',
  outputDir: './test-results-mock',
  workers: 1,
  timeout: 40_000,
  use: {
    baseURL: 'http://127.0.0.1:5179',
    viewport: { width: 1440, height: 1000 },
    launchOptions: { args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] },
    trace: 'retain-on-failure',
  },
  webServer: {
    command: '../start-dev.sh',
    env: { FRONTEND_PORT: '5179', MOCK_PORT: '8019', MOCK_DATA_FILE: '.data/playwright-state.json' },
    url: 'http://127.0.0.1:5179/api/health',
    reuseExistingServer: false,
    gracefulShutdown: { signal: 'SIGTERM', timeout: 5000 },
  },
})
