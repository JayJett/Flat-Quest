import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
  testDir: './tests/browser',
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: 0,
  workers: 2,
  reporter: 'list',
  use: { serviceWorkers: 'block', baseURL: 'http://127.0.0.1:3013/Flat-Quest/', trace: 'retain-on-failure' },
  webServer: { env: { BASE_PATH: '/Flat-Quest/' }, command: 'npm run preview -- --host 127.0.0.1 --port 3013 --strictPort', url: 'http://127.0.0.1:3013/Flat-Quest/', reuseExistingServer: !process.env.CI },
  projects: [
    { name: 'desktop-chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'small-iphone-webkit', use: { ...devices['iPhone SE'], viewport: { width: 320, height: 568 } } },
    { name: 'reduced-motion', use: { ...devices['Desktop Chrome'], viewport: { width: 390, height: 844 }, reducedMotion: 'reduce' } },
  ],
})



