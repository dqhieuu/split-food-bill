import { banks } from './banks';

/** VietQR transfer notes allow 25 unaccented characters. Keep the purpose intact. */
export function qrPaymentMessage(payerName: string): string {
	const name = payerName
		.normalize('NFD')
		.replace(/\p{Diacritic}/gu, '')
		.replace(/đ/g, 'd')
		.replace(/Đ/g, 'D')
		.replace(/[^a-z0-9 ]/gi, '')
		.trim()
		.replace(/\s+/g, ' ');
	const purpose = ' tra tien an QR';
	const budget = 25 - purpose.length;
	const shortName = name.length <= budget ? name : name.split(' ').at(-1)!.slice(0, budget);
	return `${shortName || 'Ban'}${purpose}`;
}

// VietQR EMVCo payload generated locally without sending bank details to a QR service.
function field(id: string, value: string): string {
	return id + new TextEncoder().encode(value).length.toString().padStart(2, '0') + value;
}
export function crc16(value: string) {
	let crc = 0xffff;
	for (const byte of new TextEncoder().encode(value)) {
		crc ^= byte << 8;
		for (let bit = 0; bit < 8; bit++) crc = crc & 0x8000 ? (crc << 1) ^ 0x1021 : crc << 1;
		crc &= 0xffff;
	}
	return crc.toString(16).toUpperCase().padStart(4, '0');
}
export function vietQrPayload(bankCode: string, account: string, amount: number, description: string) {
	const consumer = field('00', bankCode) + field('01', account);
	const merchant = field('00', 'A000000727') + field('01', consumer) + field('02', 'QRIBFTTA');
	const content =
		field('00', '01') +
		field('01', '12') +
		field('38', merchant) +
		field('53', '704') +
		field('54', String(amount)) +
		field('58', 'VN') +
		field('62', field('08', description.slice(0, 25))) +
		'6304';
	return content + crc16(content);
}
export const bankNames: Record<string, string> = Object.fromEntries(
	banks.filter((bank) => bank.bin).map((bank) => [bank.bin, bank.shortName])
);

export function resolveBank(value: string): { code: string; label: string } {
	const label = value.trim();
	const normalize = (text: string) =>
		text
			.normalize('NFD')
			.replace(/\p{Diacritic}/gu, '')
			.toLowerCase()
			.replace(/đ/g, 'd')
			.replace(/[^a-z0-9]/g, '');
	if (bankNames[label]) return { code: label, label: bankNames[label] };
	const matches = (name: string) => normalize(name) === normalize(label);
	const match =
		banks.find((bank) => [bank.code, bank.shortName, bank.name].some(matches)) ??
		banks.find((bank) => bank.aliases.some(matches));
	if (match) return { code: match.bin, label: match.shortName };
	return { code: /^\d{6}$/.test(label) ? label : '', label };
}
