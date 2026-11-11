import { readFile } from 'node:fs/promises';
import { initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { z } from 'zod';
import { collectionKeys } from '../src/lib/domain/types.ts';

const [path, ...extra] = process.argv.slice(2);
if (!path || extra.length) throw new Error('Usage: pnpm restore:local <group-backup.json>');

process.env.FIRESTORE_EMULATOR_HOST ??= '127.0.0.1:8080';
if (process.env.FIRESTORE_EMULATOR_HOST !== '127.0.0.1:8080')
	throw new Error('Restoring requires the local Firestore emulator.');

const documentId = z.string().regex(/^(?!\.{1,2}$|__.*__$)[\w.-]{1,1500}$/);
const record = z.looseObject({ id: documentId });
const member = record.extend({
	id: z.string().regex(/^discord_\d{17,20}$/),
	name: z.string(),
	active: z.boolean(),
	role: z.enum(['admin', 'member']),
	bankCode: z.string(),
	bankAccount: z.string(),
	color: z.string()
});
const schema = z.object({
	version: z.number().int().nonnegative(),
	...Object.fromEntries(collectionKeys.map((key) => [key, z.array(record)])),
	members: z.array(member)
});
const snapshot = schema.parse(JSON.parse((await readFile(path, 'utf8')).replace(/^\uFEFF/, '')));
if (!snapshot.members.some((entry) => entry.active && entry.role === 'admin'))
	throw new Error('The backup must contain an active group administrator.');

const collections = new Map();
for (const key of collectionKeys) {
	const rows = snapshot[key];
	const byId = new Map(rows.map((entry) => [entry.id, entry]));
	if (byId.size !== rows.length) throw new Error(`Duplicate document IDs in ${key}.`);
	collections.set(key, byId);
}

const db = getFirestore(initializeApp({ projectId: 'demo-lunchroom' }));
try {
	const group = db.doc('groups/local');
	await db.runTransaction(async (transaction) => {
		const metadata = await transaction.get(group);
		if (!metadata.exists) throw new Error('Start pnpm dev to initialize the local group first.');
		const current = await Promise.all(
			collectionKeys.map(async (key) => [key, await transaction.get(group.collection(key))])
		);
		for (const [key, existing] of current) {
			const rows = collections.get(key);
			for (const doc of existing.docs) if (!rows.has(doc.id)) transaction.delete(doc.ref);
			for (const [id, entry] of rows) transaction.set(group.collection(key).doc(id), entry);
		}
		// Bump the polling version so connected clients cannot keep a cached copy of the old group.
		transaction.update(group, {
			version: Math.max(snapshot.version, metadata.get('version') + 1),
			localSnapshot: true
		});
	});
	console.log(`Restored groups/local from backup version ${snapshot.version}:`);
	for (const [key, rows] of collections) console.log(`  ${key}: ${rows.size}`);
} finally {
	await db.terminate();
}
