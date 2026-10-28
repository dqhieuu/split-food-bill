import { z } from 'zod';
import { DomainError } from '../../src/lib/domain/ledger';
import type { GlobalUser } from '../../src/lib/domain/types';
import type { DataStore as Store } from './store';

/** The caller supplies the authenticated uid, never a user id from the request body. */
export async function saveUserPreferences(store: Store, uid: string, input: unknown) {
	const preferences = z.object({ discordBillNotifications: z.boolean() }).strict().parse(input);
	return store.transaction(async (tx, writes) => {
		const user = await store.get<GlobalUser>(`users/${uid}`, tx);
		if (!user) throw new DomainError('Không tìm thấy tài khoản.', 404);
		const updated = { ...user.preferences, ...preferences };
		writes.push(
			store.write(`users/${uid}`, { ...user, preferences: updated, updatedAt: new Date().toISOString() })
		);
		return updated;
	});
}
