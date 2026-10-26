import type { Bill, Group } from './types';
import { billDateLabel, currency } from './ledger';

const text = (value: string) => value.replace(/\s+/g, ' ').replace(/([\\`*_~|\[\]<>])/g, '\\$1');

export function billNotificationMessage(
	bill: Bill,
	group: Pick<Group, 'name'>,
	recipient: string,
	origin: string
) {
	const line = bill.lines.find((entry) => entry.memberId === recipient);
	if (!line) throw new Error('Notification recipient is not a bill participant.');
	const message = [
		'Chia tiền ăn',
		`Hóa đơn: ${text(bill.description)}`,
		`Nhóm: ${text(group.name)}`,
		`Ăn vào ${billDateLabel(bill.date)}`,
		`Người đã thanh toán: ${text(bill.memberNames?.[bill.organizer] ?? bill.organizer)}`,
		`Phần của bạn: ${currency(line.amount)}`,
		`Tổng hóa đơn: ${currency(bill.total)}`,
		...(line.description ? [`Món ăn: ${text(line.description)}`] : []),
		...(line.note ? [`Ghi chú: ${text(line.note)}`] : [])
	].join('\n');
	const link = `\n${origin}`;
	const limit = 2000 - link.length;
	return (message.length > limit ? message.slice(0, limit - 1) + '…' : message) + link;
}
