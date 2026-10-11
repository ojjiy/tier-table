import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "tests/e2e",
  timeout: 60000,
  workers: 1,
  use: { baseURL: "http://127.0.0.1:4174", headless: true },
  webServer: {
    command: "npm run dev -- --port 4174",
    url: "http://127.0.0.1:4174",
    reuseExistingServer: false,
    env: {
      VITE_FIREBASE_API_KEY: "demo-key",
      VITE_FIREBASE_AUTH_DOMAIN: "demo-tier-table.firebaseapp.com",
      VITE_FIREBASE_PROJECT_ID: "demo-tier-table",
      VITE_FIREBASE_APP_ID: "demo-app",
      VITE_USE_EMULATORS: "true",
    },
  },
});
