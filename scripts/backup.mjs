import { readdir, readFile, stat, cp } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { resolve } from 'node:path';

export async function recoverExport(since) {
	// A Windows dev watcher can hold the temporary directory open during rename.
	const root = resolve('.');
	const candidates = [];
	for (const entry of await readdir(root, { withFileTypes: true })) {
		if (!entry.isDirectory() || !/^firebase-export-\d+\w+$/.test(entry.name)) continue;
		const path = resolve(root, entry.name);
		try {
			const info = await stat(path);
			if (info.mtimeMs < since) continue;
			const metadata = JSON.parse(await readFile(resolve(path, 'firebase-export-metadata.json'), 'utf8'));
			if (metadata.firestore?.path !== 'firestore_export' || metadata.auth?.path !== 'auth_export') continue;
			await stat(resolve(path, metadata.firestore.metadata_file));
			await stat(resolve(path, 'auth_export/accounts.json'));
			candidates.push({ path, modified: info.mtimeMs });
		} catch {
			/* Incomplete exports must never replace the saved snapshot. */
		}
	}
	const latest = candidates.sort((a, b) => b.modified - a.modified)[0];
	if (!latest) return false;
	await cp(latest.path, resolve(root, '.emulator-data'), { recursive: true, force: true });
	console.log('Saved local emulator snapshot using the Windows copy fallback.');
	return true;
}
if (process.argv[1]?.endsWith('backup.mjs')) {
	const started = Date.now();
	const child = spawn(
		process.execPath,
		[
			'node_modules/firebase-tools/lib/bin/firebase.js',
			'emulators:export',
			'.emulator-data',
			'--project',
			'demo-lunchroom',
			'--force'
		],
		{ stdio: 'inherit' }
	);
	const code = await new Promise((resolve) => {
		child.on('exit', resolve);
		child.on('error', () => resolve(1));
	});
	if (code !== 0 && !(await recoverExport(started))) process.exitCode = 1;
}
