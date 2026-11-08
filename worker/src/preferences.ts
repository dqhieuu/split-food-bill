import { z } from 'zod';
import { DomainError } from '../../src/lib/domain/ledger';
import { updateSettlementFlowPreference, type GlobalUser } from '../../src/lib/domain/types';
import type { DataStore as Store } from './store';

const identifier = z.string().regex(/^[\w.-]{1,100}$/);
const preferenceUpdate = z
	.object({
		discordBillNotifications: z.boolean().optional(),
		settlementFlow: z
			.object({
				groupId: identifier,
				expanded: z.boolean().optional(),
				baselineVersion: z.number().int().nonnegative().optional(),
				seenBatchId: identifier.optional()
			})
			.strict()
			.refine(
				({ expanded, baselineVersion, seenBatchId }) =>
					expanded !== undefined || baselineVersion !== undefined || seenBatchId !== undefined
			)
			.optional()
	})
	.strict()
	.refine(
		({ discordBillNotifications, settlementFlow }) =>
			discordBillNotifications !== undefined || !!settlementFlow
	);

/** The caller supplies the authenticated uid, never a user id from the request body. */
export async function saveUserPreferences(store: Store, uid: string, input: unknown) {
	const { discordBillNotifications, settlementFlow } = preferenceUpdate.parse(input);
	return store.transaction(async (tx, writes) => {
		const user = await store.get<GlobalUser>(`users/${uid}`, tx);
		if (!user) throw new DomainError('Không tìm thấy tài khoản.', 404);
		const updated = { ...user.preferences };
		if (discordBillNotifications !== undefined) updated.discordBillNotifications = discordBillNotifications;
		if (settlementFlow) {
			const { groupId, ...change } = settlementFlow;
			updated.settlementFlow = {
				...updated.settlementFlow,
				[groupId]: updateSettlementFlowPreference(updated.settlementFlow?.[groupId], change)
			};
		}
		writes.push(
			store.write(`users/${uid}`, { ...user, preferences: updated, updatedAt: new Date().toISOString() })
		);
		return updated;
	});
}
