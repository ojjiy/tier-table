import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "tests/e2e",
  timeout: 45000,
  workers: 1,
  use: { baseURL: "http://127.0.0.1:4176", headless: true },
  webServer: {
    command: "npm run dev -- --port 4176",
    url: "http://127.0.0.1:4176",
    reuseExistingServer: false,
    env: { VITE_FIREBASE_API_KEY: "", VITE_FIREBASE_PROJECT_ID: "" },
  },
});
