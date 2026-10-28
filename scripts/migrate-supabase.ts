import { readFile, mkdir, writeFile, stat } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { Store } from '../worker/src/store';
import { databasePool } from '../worker/src/supabase-store';
import type { Env } from '../worker/src/env';
import {
	exportFirestore,
	importSnapshot,
	snapshotSummary,
	validateSnapshot,
	verifySnapshot
} from './lib/database-migration';

const [action, ...args] = process.argv.slice(2);
const actions = ['check', 'schema', 'export', 'import', 'verify'];
if (
	!actions.includes(action) ||
	args.length % 2 ||
	args.some(
		(value, index) => index % 2 === 0 && !['--secrets', '--snapshot', '--project', '--mode'].includes(value)
	)
) {
	console.log(
		'Usage: npm run migrate:supabase -- <check|schema|export|import|verify> --secrets .dev.vars.production.json --snapshot artifacts/migration/firestore.json --project split-food-bill --mode production'
	);
	process.exit(action ? 1 : 0);
}
const options = Object.fromEntries(
	Array.from({ length: args.length / 2 }, (_, index) => [args[index * 2], args[index * 2 + 1]])
);
const mode = options['--mode'] ?? 'production';
if (!['production', 'local'].includes(mode)) throw new Error('Invalid migration mode.');
const settings = JSON.parse(await readFile(options['--secrets'] ?? '.dev.vars.production.json', 'utf8'));
const projectId = options['--project'] ?? 'split-food-bill';
const env = { ...settings, APP_ENV: mode, FIREBASE_PROJECT_ID: projectId } as Env;
const snapshotFile = resolve(options['--snapshot'] ?? 'artifacts/migration/firestore.json');

try {
	if (action === 'export') {
		await stat(snapshotFile).then(
			() => {
				throw new Error('Snapshot file already exists. Choose a new --snapshot filename.');
			},
			(error: NodeJS.ErrnoException) => {
				if (error.code !== 'ENOENT') throw error;
			}
		);
		if (mode === 'production' && (!env.FIREBASE_CLIENT_EMAIL || !env.FIREBASE_PRIVATE_KEY))
			throw new Error('Firestore source credentials are missing.');
		const snapshot = await exportFirestore(new Store(env), projectId);
		await mkdir(dirname(snapshotFile), { recursive: true });
		// Never overwrite an earlier backup. Use a new --snapshot path for the final frozen export.
		await writeFile(snapshotFile, JSON.stringify(snapshot), { flag: 'wx', mode: 0o600 });
		console.log(JSON.stringify({ action, file: snapshotFile, ...snapshotSummary(snapshot) }, null, 2));
	} else {
		const pool = databasePool(env);
		try {
			if (action === 'check') {
				const result = await pool.query(
					"select current_database() as database, current_user as role, to_regclass('app_data.documents') is not null as schema_ready"
				);
				console.log(
					JSON.stringify({ connection: 'ok', tlsVerified: mode === 'production', ...result.rows[0] })
				);
			} else if (action === 'schema') {
				const schema = await readFile(
					new URL('../supabase/migrations/202610280001_documents.sql', import.meta.url),
					'utf8'
				);
				await pool.query(`begin; ${schema} commit;`);
				console.log('Private database schema is ready.');
			} else {
				const snapshot = validateSnapshot(JSON.parse(await readFile(snapshotFile, 'utf8')));
				if (snapshot.projectId !== projectId) throw new Error('Snapshot project does not match --project.');
				if (action === 'import') await importSnapshot(pool, snapshot);
				console.log(JSON.stringify({ action, ...(await verifySnapshot(pool, snapshot)) }));
			}
		} finally {
			await pool.end();
		}
	}
} catch (error) {
	// Do not log credential-bearing connection strings, SQL row data, or driver detail fields.
	console.error(
		JSON.stringify({
			migration: 'failed',
			code: (error as { code?: string }).code ?? 'validation',
			message:
				error instanceof Error && !('code' in error)
					? error.message
					: 'Database operation failed. Source data was not modified.'
		})
	);
	process.exitCode = 1;
}
