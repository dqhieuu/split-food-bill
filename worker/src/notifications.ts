import type { Bill, NotificationDelivery, Receipt } from '../../src/lib/domain/types';
import { billNotificationMessage } from '../../src/lib/domain/notifications';
import { DomainError } from '../../src/lib/domain/ledger';
import { requireGroup } from './groups';
import { Discord } from './discord';
import { billImageAttachment } from './images';
import type { Env } from './env';
import type { DataStore as Store } from './store';

function summarize(receipt: Receipt) {
	receipt.status = receipt.deliveries.some((delivery) => delivery.status === 'sending')
		? 'sending'
		: receipt.deliveries.some((delivery) => delivery.status === 'failed')
			? 'failed'
			: receipt.deliveries.some((delivery) => delivery.status === 'queued')
				? 'queued'
				: receipt.deliveries.every((delivery) => delivery.status === 'simulated')
					? 'simulated'
					: 'sent';
	const failed = receipt.deliveries.filter((delivery) => delivery.status === 'failed').length;
	receipt.error = failed ? `Không gửi được thông báo cho ${failed} người. Hóa đơn đã được ghi.` : '';
}

/** Claims delivery after the financial commit; external calls never run inside a transaction. */
export async function deliverBillNotifications(
	store: Store,
	env: Env,
	groupId: string,
	actor: string,
	billId: string,
	retry = false
) {
	const path = `groups/${groupId}/receipts/${billId}`;
	const batch = await store.transaction(async (tx, writes) => {
		const { group, member } = await requireGroup(store, groupId, actor, false, tx);
		const bill = await store.get<Bill>(`groups/${groupId}/bills/${billId}`, tx);
		if (!bill) throw new DomainError('Không tìm thấy hóa đơn.', 404);
		if (bill.undoneAt) throw new DomainError('Hóa đơn đã được hoàn tác nên không gửi thông báo.', 409);
		if (bill.organizer !== actor && member.role !== 'admin')
			throw new DomainError(
				'Chỉ người thanh toán hóa đơn hoặc quản trị viên nhóm được gửi lại thông báo.',
				403
			);
		const receipt = await store.get<Receipt>(path, tx);
		if (!bill.discordNotification || !receipt) return null;
		if (receipt.status === 'sending') return null;
		const pending = receipt.deliveries.filter(
			(delivery) => delivery.status === 'queued' || (retry && delivery.status === 'failed')
		);
		if (!pending.length) return null;
		if (
			pending.some(
				(delivery) =>
					!/^discord_\d{17,20}$/.test(delivery.memberId) ||
					!bill.lines.some((line) => line.memberId === delivery.memberId)
			)
		)
			throw new DomainError('Danh sách nhận thông báo không hợp lệ.', 400);
		for (const delivery of pending) {
			delivery.status = 'sending';
			delivery.error = '';
		}
		receipt.attempts++;
		receipt.status = 'sending';
		receipt.error = '';
		writes.push(store.write(path, receipt));
		return {
			bill,
			group,
			recipients: pending.map((delivery) => delivery.memberId),
			attempt: receipt.attempts
		};
	});
	if (!batch) return;
	const discord = new Discord(env);
	// One read serves every recipient; a missing photo must not block the text notification.
	const attachment = batch.bill.image
		? await billImageAttachment(env, groupId, batch.bill.image).catch((cause) => {
				console.error(
					'Bill image could not be attached to Discord DMs.',
					cause instanceof Error ? cause.message : cause
				);
				return null;
			})
		: null;
	const pending = [...batch.recipients];
	const errors: unknown[] = [];
	let saveTail = Promise.resolve();
	await Promise.all(
		Array.from({ length: Math.min(4, pending.length) }, async () => {
			for (;;) {
				const uid = pending.shift();
				if (!uid) return;
				let status: NotificationDelivery['status'];
				let error = '';
				try {
					const digest = new Uint8Array(
						await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`${groupId}:${billId}:${uid}`))
					);
					const nonce = [...digest.slice(0, 12)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
					({ status } = await discord.dm(
						uid.slice(8),
						billNotificationMessage(batch.bill, batch.group, uid, env.FRONTEND_ORIGIN, attachment?.name),
						nonce,
						attachment
					));
				} catch {
					status = 'failed';
					error = 'Không gửi được DM. Kiểm tra quyền của bot và cài đặt tin nhắn riêng.';
				}
				try {
					const save = saveTail.then(() =>
						store.transaction(async (tx, writes) => {
							const receipt = await store.get<Receipt>(path, tx);
							if (!receipt || receipt.attempts !== batch.attempt) return;
							const delivery = receipt.deliveries.find((item) => item.memberId === uid);
							if (!delivery || delivery.status !== 'sending') return;
							delivery.status = status;
							delivery.error = error;
							summarize(receipt);
							writes.push(store.write(path, receipt));
						})
					);
					saveTail = save.catch(() => {});
					await save;
				} catch (cause) {
					errors.push(cause);
				}
			}
		})
	);
	if (errors.length) throw new Error('Could not persist Discord delivery results.');
}
