import {defineConfig} from '@playwright/test';
export default defineConfig({testDir:'tests',testMatch:'pages.spec.ts',workers:1,use:{baseURL:'http://127.0.0.1:4175',headless:true},webServer:{command:'npm run build && npm run preview -- --port 4175',url:'http://127.0.0.1:4175/tier-table/',reuseExistingServer:false,env:{VITE_BASE_PATH:'/tier-table/'}}});
