import { defineConfig } from '@playwright/test';
export default defineConfig({
	testDir: 'tests/e2e',
	fullyParallel: false,
	workers: 1,
	timeout: 45000,
	use: {
		baseURL: process.env.PLAYWRIGHT_BASE_URL || 'http://127.0.0.1:5173',
		channel: 'chrome',
		headless: true,
		reducedMotion: 'reduce',
		trace: 'retain-on-failure',
		screenshot: 'only-on-failure'
	},
	reporter: 'list'
});
