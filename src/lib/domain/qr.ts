// VietQR EMVCo payload generated locally; bank details never leave the app.
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
export const bankNames: Record<string, string> = {
	'970436': 'Vietcombank',
	'970422': 'MB Bank',
	'970418': 'BIDV',
	'970407': 'Techcombank',
	'970415': 'VietinBank',
	'970416': 'ACB',
	'970432': 'VPBank',
	'970423': 'TPBank',
	'970403': 'Sacombank',
	'970405': 'Agribank'
};

export function resolveBank(value: string): { code: string; label: string } {
	const label = value.trim();
	const normalize = (text: string) =>
		text
			.normalize('NFD')
			.replace(/\p{Diacritic}/gu, '')
			.toLowerCase()
			.replace(/[^a-z0-9]/g, '');
	const match = Object.entries(bankNames).find(
		([code, name]) => code === label || normalize(name) === normalize(label)
	);
	if (match) return { code: match[0], label: match[1] };
	return { code: /^\d{6}$/.test(label) ? label : '', label };
}
