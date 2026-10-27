import type { Bill, Group } from './types';
import { billDateLabel, currency } from './ledger';

export type DiscordEmbed = {
	title?: string;
	description?: string;
	color: number;
	image?: { url: string };
};
export type DiscordMessage = { content?: string; embeds: DiscordEmbed[] };

function text(value: string, limit: number) {
	const characters = Array.from(value.replace(/\s+/g, ' ').trim());
	const shortened =
		characters.length > limit ? characters.slice(0, limit - 1).join('') + '…' : characters.join('');
	return shortened.replace(/([\\`*_~|\[\]<>])/g, '\\$1');
}

/** Builds personalized rich embeds; receipt images use private uploaded attachments. */
export function billNotificationMessage(
	bill: Bill,
	group: Pick<Group, 'id' | 'name'>,
	recipient: string,
	origin: string,
	attachmentName?: string
): DiscordMessage {
	const line = bill.lines.find((entry) => entry.memberId === recipient);
	if (!line) throw new Error('Notification recipient is not a bill participant.');
	const paymentUrl = new URL('/balances', origin);
	paymentUrl.searchParams.set('group', group.id);
	paymentUrl.searchParams.set('to', bill.organizer);
	const billUrl = new URL('/activity', origin);
	billUrl.searchParams.set('group', group.id);
	billUrl.searchParams.set('bill', bill.id);
	const others = bill.lines.filter((entry) => entry.memberId !== recipient);
	const heading = [
		`**Hoá đơn:** ${text(bill.description, 160)} ngày ${billDateLabel(bill.date)}`,
		'',
		`**${bill.alreadyPaid ? 'Đã thanh toán' : 'Bạn phải trả'}: ${currency(line.amount)}**${line.description ? ` cho ${text(line.description, 120)}` : ''}`,
		...(others.length ? ['', '**Người khác:**'] : [])
	].join('\n');
	const ending = `${others.length ? `\n\n**Tổng cộng: ${currency(bill.total)}**` : ''}${
		bill.alreadyPaid
			? `\n\n**Trạng thái:** Mọi người đã thanh toán đầy đủ.\n\n[Xem hóa đơn](<${billUrl.href}>)`
			: `\n\n**Link trả tiền:** [Mở mã QR](<${paymentUrl.href}>)`
	}`;
	const rows: string[] = [];
	for (const other of others) {
		const row = `- ${text(bill.memberNames?.[other.memberId] ?? other.memberId, 60)} ${bill.alreadyPaid ? 'đã thanh toán' : 'trả'} ${currency(other.amount)}${other.description ? ` cho ${text(other.description, 100)}` : ''}`;
		const remaining = others.length - rows.length - 1;
		const overflow = remaining ? `\n- … và ${remaining} người khác ([xem hóa đơn](<${billUrl.href}>)).` : '';
		if (`${heading}\n${[...rows, row].join('\n')}${overflow}${ending}`.length > 4096) break;
		rows.push(row);
	}
	if (rows.length < others.length)
		rows.push(`- … và ${others.length - rows.length} người khác ([xem hóa đơn](<${billUrl.href}>)).`);
	const title = `Nhóm: ${group.name.replace(/\s+/g, ' ').trim().slice(0, 100)}`;
	const description = `${heading}${others.length ? `\n${rows.join('\n')}` : ''}${ending}`;
	const color = 0x315e47;
	return {
		embeds: attachmentName
			? [
					{ title, color, image: { url: `attachment://${attachmentName}` } },
					{ color, description }
				]
			: [{ title, color, description }]
	};
}
