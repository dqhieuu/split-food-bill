import { spawn } from 'node:child_process';
const children = [];
let stopping = false;
const seed = spawn(process.execPath, ['--import', 'tsx', 'scripts/seed-local.mjs'], {
	stdio: 'inherit',
	env: process.env
});
const code = await new Promise((resolve) => seed.on('exit', resolve));
if (code !== 0) process.exit(Number(code) || 1);
children.push(
	spawn(
		process.execPath,
		['node_modules/wrangler/bin/wrangler.js', 'dev', '--env', 'local', '--ip', '127.0.0.1', '--port', '8787'],
		{ stdio: 'inherit', env: process.env }
	)
);
children.push(
	spawn(process.execPath, ['node_modules/vite/bin/vite.js', '--host', '127.0.0.1', '--strictPort'], {
		stdio: 'inherit',
		env: process.env
	})
);
function stop(status = 0) {
	if (stopping) return;
	stopping = true;
	process.exitCode = status;
	for (const child of children) {
		if (child.exitCode !== null || !child.pid) continue;
		if (process.platform === 'win32')
			spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true });
		else child.kill();
	}
}
process.on('SIGINT', () => stop());
process.on('SIGTERM', () => stop());
for (const child of children) {
	child.on('error', (error) => {
		console.error(error.message);
		stop(1);
	});
	child.on('exit', (status) => {
		stop(status || 0);
	});
}
