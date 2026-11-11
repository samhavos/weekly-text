import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  workers: 2,
  reporter: 'list',
  use: {
    ...devices['Desktop Chrome'],
    timezoneId: 'Europe/Oslo',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    { name: 'root', use: { baseURL: 'http://127.0.0.1:4173/' } },
    { name: 'sub-path', use: { baseURL: 'http://127.0.0.1:4174/weekly-text/' } },
  ],
  webServer: [
    {
      command: 'npm run preview -- --port 4173 --strictPort',
      url: 'http://127.0.0.1:4173/',
    },
    {
      command: 'npm run preview -- --port 4174 --strictPort --base /weekly-text/',
      url: 'http://127.0.0.1:4174/weekly-text/',
    },
  ],
});
