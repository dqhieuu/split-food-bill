import { initializeApp, getApps } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

// Only records explicitly created by this test suite are removed.
export async function cleanupTestData() {
	process.env.FIRESTORE_EMULATOR_HOST = '127.0.0.1:8080';
	const app =
		getApps().find((item) => item.name === 'test-cleanup') ||
		initializeApp({ projectId: 'demo-lunchroom' }, 'test-cleanup');
	const db = getFirestore(app);
	const root = db.doc('groups/local');
	for (const document of (await db.collection('groups').get()).docs) {
		if (/^E2E test group \d+$/.test(document.data().name ?? '')) {
			await db.doc(`discordChannels/${document.data().discordChannelId}`).delete();
			await db.recursiveDelete(document.ref);
		}
	}
	const owner = await db.doc('users/discord_100000000000000001').get();
	if (owner.exists) await owner.ref.update({ lastActiveGroupId: 'local' });
	await db.runTransaction(async (transaction) => {
		const [metadata, bills, ledger, receipts, audit, members] = await Promise.all([
			transaction.get(root),
			...['bills', 'ledger', 'receipts', 'audit', 'members'].map((key) =>
				transaction.get(root.collection(key))
			)
		]);
		const billIds = new Set(
			bills.docs
				.filter(
					(document) =>
						/^Bữa trưa kiểm thử \d+$/.test(document.data().description) ||
						document.data().description === 'Concurrent test' ||
						document.id.startsWith('e2e-')
				)
				.map((document) => document.id)
		);
		const references = new Set(billIds);
		for (const document of ledger.docs) {
			const entry = document.data();
			if (
				billIds.has(entry.reference) ||
				entry.description === 'Hoàn tiền kiểm thử tự động' ||
				entry.from.startsWith('e2e-') ||
				entry.to.startsWith('e2e-') ||
				document.id.startsWith('e2e-')
			) {
				references.add(entry.reference);
				references.add(document.id);
				transaction.delete(document.ref);
			}
		}
		for (const document of [...bills.docs, ...receipts.docs])
			if (billIds.has(document.id)) transaction.delete(document.ref);
		for (const document of members.docs) if (document.id.startsWith('e2e-')) transaction.delete(document.ref);
		for (const document of audit.docs)
			if (references.has(document.data().reference) || document.data().reference?.startsWith('e2e-'))
				transaction.delete(document.ref);
		transaction.update(root, { version: (metadata.data()?.version || 0) + 1 });
	});
}
if (process.argv[1]?.endsWith('cleanup-test-data.mjs')) await cleanupTestData();
