import { getApps, initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore, type Transaction } from 'firebase-admin/firestore';
import type { AppState } from '$lib/domain/types';
import { collectionKeys } from '$lib/domain/types';
import { createDemoState } from '$lib/domain/seed';
import { DomainError } from '$lib/domain/ledger';

export const projectId = 'demo-lunchroom';
export const demoPassword = 'local-lunchroom-only';
export function getLocalFirebase() {
	// Fail closed: this prototype can never fall through to live Firebase.
	if (
		!/^127\.0\.0\.1:\d+$/.test(process.env.FIRESTORE_EMULATOR_HOST || '') ||
		!/^127\.0\.0\.1:\d+$/.test(process.env.FIREBASE_AUTH_EMULATOR_HOST || '')
	) {
		throw new DomainError('Chưa kết nối bộ giả lập Firebase. Hãy chạy npm run dev trong thư mục dự án.', 503);
	}
	const app = getApps()[0] || initializeApp({ projectId });
	return { db: getFirestore(app), auth: getAuth(app) };
}
async function readState(transaction?: Transaction): Promise<AppState> {
	const { db } = getLocalFirebase();
	const root = db.doc('groups/local');
	const meta = transaction ? await transaction.get(root) : await root.get();
	const state = { version: meta.data()?.version || 0 } as AppState;
	for (const key of collectionKeys) {
		const collection = root.collection(key);
		const snapshot = transaction ? await transaction.get(collection) : await collection.get();
		(state[key] as unknown[]) = snapshot.docs.map((doc) => doc.data());
	}
	return state;
}
export async function ensureDemoState() {
	const { db } = getLocalFirebase();
	const exists = await db.doc('groups/local').get();
	if (exists.exists) return;
	await db.runTransaction(async (tx) => {
		const root = db.doc('groups/local');
		if ((await tx.get(root)).exists) return;
		const state = createDemoState();
		tx.set(root, { version: state.version });
		for (const key of collectionKeys)
			for (const entity of state[key]) tx.set(root.collection(key).doc(entity.id), entity);
	});
}
export async function loadState() {
	const { db } = getLocalFirebase();
	return db.runTransaction((tx) => readState(tx), { readOnly: true });
}
export async function mutateState<T>(
	operation: (state: AppState) => T
): Promise<{ result: T; state: AppState }> {
	const { db } = getLocalFirebase();
	return db.runTransaction(async (tx) => {
		const state = await readState(tx);
		const original = structuredClone(state);
		const result = operation(state);
		for (const key of collectionKeys) {
			const before = new Map(original[key].map((item) => [item.id, JSON.stringify(item)]));
			for (const entity of state[key])
				if (before.get(entity.id) !== JSON.stringify(entity))
					tx.set(db.doc(`groups/local/${key}/${entity.id}`), entity);
		}
		tx.set(db.doc('groups/local'), { version: state.version });
		return { result, state };
	});
}
export async function actorFromRequest(request: Request) {
	const authorization = request.headers.get('authorization');
	if (!authorization?.startsWith('Bearer ')) throw new DomainError('Vui lòng đăng nhập lại.', 401);
	try {
		return (await getLocalFirebase().auth.verifyIdToken(authorization.slice(7))).uid;
	} catch {
		throw new DomainError('Phiên đăng nhập không hợp lệ. Vui lòng chọn lại tài khoản.', 401);
	}
}
