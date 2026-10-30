import { initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

// Additive, repeatable fixtures for a selected local group. Never contacts production.
process.env.FIRESTORE_EMULATOR_HOST ??= '127.0.0.1:8080';
if (process.env.FIRESTORE_EMULATOR_HOST !== '127.0.0.1:8080')
	throw new Error('Leaderboard demo seeding requires the local Firestore emulator.');
const groupId = process.argv[2];
if (!groupId || groupId.includes('/')) throw new Error('Pass the local group ID.');
const db = getFirestore(initializeApp({ projectId: 'demo-lunchroom' }, 'leaderboard-demo-seed'));
const group = db.doc(`groups/${groupId}`);
const names = ['Ngọc Mai', 'Hoàng Nam', 'Tường Vy', 'Đăng Khoa', 'Bảo Chi', 'Gia Hân'];
const colors = ['#b0788e', '#8e8e5d', '#8d7cac', '#5e999c', '#b78c50', '#a26468'];
const ids = names.map((_, index) => `discord_${900000000000000101n + BigInt(index)}`);
const now = new Date().toISOString();
const records = names.map((name, index) => ({
	ref: group.collection('members').doc(ids[index]),
	data: { id: ids[index], name, color: colors[index], active: true, role: 'member', bankCode: '', bankAccount: '', avatarUrl: '' }
}));
const amounts = [[4, 0, 210000], [5, 0, 30000], [5, 1, 80000]];
const added = await db.runTransaction(async transaction => {
	const root = await transaction.get(group);
	if (!root.exists) throw new Error('The requested local group does not exist.');
	const actor = root.data().createdBy;
	const debts = amounts.map(([from, to, amount], index) => {
		const id = `leaderboard-demo-debt-${index + 1}`;
		return { ref: group.collection('ledger').doc(id), data: {
			id, from: ids[from], to: ids[to], amount, type: 'debt', date: now, createdAt: now,
			description: 'Dữ liệu mẫu bảng xếp hạng', note: 'Local demo fixture', creator: actor,
			source: 'manual', reference: 'leaderboard-demo'
		} };
	});
	const all = [...records, ...debts];
	const snapshots = await transaction.getAll(...all.map(record => record.ref));
	let count = 0;
	all.forEach((record, index) => { if (!snapshots[index].exists) { transaction.create(record.ref, record.data); count++; } });
	if (count) {
		transaction.update(group, { version: (root.data().version || 0) + 1 });
		transaction.set(group.collection('audit').doc('leaderboard-demo'), {
			id: 'leaderboard-demo', actor, action: 'Thêm thành viên và số dư mẫu bảng xếp hạng (local)', date: now, reference: 'leaderboard-demo'
		});
	}
	return count;
});
console.log(`Added ${added} demo records to ${groupId}; existing members and transactions preserved.`);
await db.terminate();
