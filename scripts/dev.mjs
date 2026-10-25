import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { recoverExport } from './backup.mjs';
const started = Date.now();

// Firebase owns startup, child command lifetime and graceful emulator export.
const emulatorOnly = process.argv.includes('--emulators-only');
const args = [
	emulatorOnly ? 'emulators:start' : 'emulators:exec',
	'--project',
	'demo-lunchroom',
	'--export-on-exit=.emulator-data'
];
if (existsSync('.emulator-data/firebase-export-metadata.json')) args.push('--import=.emulator-data');
if (!emulatorOnly) args.push('node node_modules/vite/bin/vite.js --host 127.0.0.1');
const child = spawn(process.execPath, ['node_modules/firebase-tools/lib/bin/firebase.js', ...args], {
	stdio: 'inherit',
	env: {
		...process.env,
		FIRESTORE_EMULATOR_HOST: '127.0.0.1:8080',
		FIREBASE_AUTH_EMULATOR_HOST: '127.0.0.1:9099',
		GCLOUD_PROJECT: 'demo-lunchroom'
	}
});
// Ctrl+C also reaches Firebase in the shared console. Let it finish exporting.
process.on('SIGINT', () => {});
process.on('SIGTERM', () => {
	if (process.platform !== 'win32') child.kill('SIGTERM');
});
child.on('error', (error) => {
	console.error(error.message);
	process.exitCode = 1;
});
child.on('exit', async (code) => {
	await recoverExport(started).catch((error) =>
		console.error('Could not save emulator snapshot:', error.message)
	);
	process.exitCode = code || 0;
});
