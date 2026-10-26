import type { Bill, Group } from './types';
import { billDateLabel, currency } from './ledger';

function text(value: string, limit: number) {
	const characters = Array.from(value.replace(/\s+/g, ' ').trim());
	const shortened =
		characters.length > limit ? characters.slice(0, limit - 1).join('') + '…' : characters.join('');
	return shortened.replace(/([\\`*_~|\[\]<>])/g, '\\$1');
}

export function billNotificationMessage(
	bill: Bill,
	group: Pick<Group, 'name'>,
	recipient: string,
	origin: string
) {
	const line = bill.lines.find((entry) => entry.memberId === recipient);
	if (!line) throw new Error('Notification recipient is not a bill participant.');
	return [
		`**Hóa đơn: ${text(bill.description, 120)}**`,
		`${text(group.name, 80)} · Ăn vào ${billDateLabel(bill.date)}`,
		'',
		`**Phần của bạn: ${currency(line.amount)}**`,
		...(line.description ? [`• Món ăn: ${text(line.description, 120)}`] : []),
		...(line.note ? [`• Ghi chú: ${text(line.note, 240)}`] : []),
		'',
		`Người đã thanh toán: **${text(bill.memberNames?.[bill.organizer] ?? bill.organizer, 80)}**`,
		`Tổng hóa đơn: **${currency(bill.total)}**`,
		'',
		`[Mở Chia tiền ăn](<${new URL(origin).origin}>)`
	].join('\n');
}
