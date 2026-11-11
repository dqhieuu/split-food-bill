import { sveltekit } from '@sveltejs/kit/vite';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vite';
import adapter from '@sveltejs/adapter-vercel';
import nodeAdapter from '@sveltejs/adapter-node';
import { fileURLToPath } from 'node:url';

export default defineConfig({
	server: {
		watch: { ignored: ['**/.wrangler/**', '**/.emulator-data/**', '**/artifacts/**', '**/*-debug.log'] }
	},
	resolve: { alias: { $lib: fileURLToPath(new URL('./src/lib', import.meta.url)) } },
	plugins: [
		tailwindcss(),
		sveltekit({ adapter: process.env.VERCEL ? adapter({ runtime: 'nodejs26.x' }) : nodeAdapter() })
	]
});
