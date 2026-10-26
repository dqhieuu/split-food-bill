import { initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { createDemoState } from '../src/lib/domain/seed.ts';

process.env.FIRESTORE_EMULATOR_HOST ??= '127.0.0.1:8080';
if (process.env.FIRESTORE_EMULATOR_HOST !== '127.0.0.1:8080')
	throw new Error('Seeding requires the local Firestore emulator.');
const db = getFirestore(initializeApp({ projectId: 'demo-lunchroom' }, 'discord-local-seed'));
const root = db.doc('groups/local');
if ((await root.get()).data()?.discordChannelId) {
	console.log('Local Discord fixtures are already initialized.');
	await db.terminate();
	process.exit(0);
}
// Discard the previous unpublished demo group; no migration of old data is attempted.
await db.recursiveDelete(root);
const state = createDemoState();
const ids = new Map(
	state.members.map((member, index) => [member.id, `discord_${100000000000000001n + BigInt(index)}`])
);
const id = (value) => {
	const uid = ids.get(value);
	if (!uid) throw new Error('Unknown fixture identity');
	return uid;
};
for (const member of state.members) {
	member.id = id(member.id);
	member.active = member.id === id('an');
	member.role = member.active ? 'admin' : 'member';
}
for (const bill of state.bills) {
	bill.organizer = id(bill.organizer);
	bill.lines.forEach((line) => {
		line.memberId = id(line.memberId);
	});
	if (bill.memberNames)
		bill.memberNames = Object.fromEntries(
			Object.entries(bill.memberNames).map(([key, name]) => [id(key), name])
		);
}
for (const entry of state.ledger) {
	entry.from = id(entry.from);
	entry.to = id(entry.to);
	entry.creator = id(entry.creator);
}
for (const event of state.audit) event.actor = id(event.actor);
const now = new Date().toISOString();
const batch = db.batch();
for (const member of state.members)
	batch.set(db.doc(`users/${member.id}`), {
		id: member.id,
		discordId: member.id.slice(8),
		name: member.name,
		username: member.name,
		email: member.email,
		avatarUrl: '',
		role: member.id === id('an') ? 'admin' : 'member',
		createdAt: now,
		updatedAt: now
	});
batch.set(root, {
	id: 'local',
	name: 'Hội ăn trưa',
	discordChannelId: '200000000000000001',
	discordGuildId: '300000000000000001',
	createdBy: id('an'),
	createdAt: now,
	version: state.version
});
batch.set(db.doc('discordChannels/200000000000000001'), {
	channelId: '200000000000000001',
	groupId: 'local'
});
for (const key of ['members', 'bills', 'ledger', 'receipts', 'settlements', 'archives', 'audit'])
	for (const row of state[key]) batch.set(root.collection(key).doc(row.id), row);
await batch.commit();
console.log(
	'Seeded a local group with mock Discord identities; all imported members except its creator are inactive.'
);
await db.terminate();
