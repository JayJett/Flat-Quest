import { defineConfig, devices } from '@playwright/test'

// Optional: point Chromium projects at an already-installed browser (sandboxes without `playwright install`).
const chromium = process.env.PW_CHROMIUM_PATH ? { launchOptions: { executablePath: process.env.PW_CHROMIUM_PATH } } : {}

export default defineConfig({
  testDir: './tests/browser',
  // The screenshot generator only runs on request: SHOTS=1 npx playwright test screenshots --project=desktop-chromium
  testIgnore: process.env.SHOTS ? [] : ['**/screenshots.spec.ts'],
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: 0,
  workers: 2,
  reporter: 'list',
  use: { serviceWorkers: 'block', baseURL: 'http://127.0.0.1:3013/Flat-Quest/', trace: 'retain-on-failure' },
  webServer: { env: { BASE_PATH: '/Flat-Quest/' }, command: 'npm run preview -- --host 127.0.0.1 --port 3013 --strictPort', url: 'http://127.0.0.1:3013/Flat-Quest/', reuseExistingServer: !process.env.CI },
  projects: [
    { name: 'desktop-chromium', use: { ...devices['Desktop Chrome'], ...chromium } },
    { name: 'small-iphone-webkit', use: { ...devices['iPhone SE'], viewport: { width: 320, height: 568 } } },
    { name: 'reduced-motion', use: { ...devices['Desktop Chrome'], ...chromium, viewport: { width: 390, height: 844 }, reducedMotion: 'reduce' } },
  ],
})



