import { z } from 'zod';
import type { AppState } from './types';
const id = z.string().regex(/^[\w.-]{1,100}$/);
export const importEntrySchema = z.object({
	id,
	from: id,
	to: id,
	type: z.enum(['debt', 'payment']),
	amount: z.number().int().min(-1_000_000_000).max(1_000_000_000),
	date: z.iso.datetime(),
	description: z.string().max(300),
	note: z.string().max(500),
	legacySequence: z.string().max(100)
});
export type ImportedEntry = z.infer<typeof importEntrySchema>;
function parseCsv(content: string): string[][] {
	const rows: string[][] = [];
	let row: string[] = [];
	let value = '';
	let quoted = false;
	for (let i = 0; i < content.length; i++) {
		const char = content[i];
		if (char === '"') {
			if (quoted && content[i + 1] === '"') {
				value += '"';
				i++;
			} else quoted = !quoted;
		} else if (char === ',' && !quoted) {
			row.push(value);
			value = '';
		} else if ((char === '\n' || char === '\r') && !quoted) {
			if (char === '\r' && content[i + 1] === '\n') i++;
			row.push(value);
			if (row.some((v) => v.trim())) rows.push(row);
			row = [];
			value = '';
		} else value += char;
	}
	if (quoted) throw new Error('Tệp CSV có dấu ngoặc kép chưa đóng.');
	row.push(value);
	if (row.some((v) => v.trim())) rows.push(row);
	return rows;
}
export function parseLedgerImport(content: string): ImportedEntry[] {
	const source = content.replace(/^\uFEFF/, '').trim();
	let rows: unknown[];
	if (source.startsWith('[') || source.startsWith('{')) {
		const parsed = JSON.parse(source);
		rows = Array.isArray(parsed) ? parsed : parsed.ledger;
	} else {
		const [header, ...values] = parseCsv(source);
		if (!header) throw new Error('Tệp chưa có dữ liệu.');
		rows = values.map((row) => Object.fromEntries(header.map((key, i) => [key.trim(), row[i] || ''])));
	}
	if (!Array.isArray(rows) || !rows.length)
		throw new Error('Không tìm thấy giao dịch. Dùng danh sách JSON hoặc tệp CSV có tiêu đề.');
	if (rows.length > 10000) throw new Error('Mỗi lần nhập tối đa 10.000 giao dịch.');
	const normalized = rows.map((row: unknown, index) => {
		const entry = row as Record<string, unknown>;
		const sequence = String(entry.legacySequence ?? entry.sequence ?? '');
		if (!entry.id && !sequence) throw new Error(`Dòng ${index + 1}: cần có id hoặc sequence cố định.`);
		if (entry.amount === '' || entry.amount === undefined || entry.amount === null)
			throw new Error(`Dòng ${index + 1}: thiếu số tiền.`);
		const date = String(entry.date || '');
		const parsedDate = new Date(date);
		if (Number.isNaN(parsedDate.getTime()) || !/^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:\d{2})$/.test(date))
			throw new Error(`Dòng ${index + 1}: ngày cần theo ISO 8601 với múi giờ.`);
		return importEntrySchema.parse({
			id: String(entry.id || `legacy-${sequence}`),
			from: String(entry.from || ''),
			to: String(entry.to || ''),
			type: entry.type === 'Nợ' ? 'debt' : entry.type === 'Trả' ? 'payment' : entry.type,
			amount: typeof entry.amount === 'number' ? entry.amount : Number(entry.amount),
			date: parsedDate.toISOString(),
			description: String(entry.description || ''),
			note: String(entry.note || ''),
			legacySequence: sequence
		});
	});
	if (new Set(normalized.map((e) => e.id)).size !== normalized.length)
		throw new Error('Mã giao dịch trong tệp bị trùng. Mỗi dòng cần có id hoặc sequence riêng.');
	return normalized;
}
export function summarizeImport(entries: ImportedEntry[], state: AppState) {
	const known = new Set(state.ledger.map((e) => e.id));
	const newEntries = entries.filter((e) => !known.has(e.id));
	return {
		total: entries.length,
		newCount: newEntries.length,
		duplicates: entries.length - newEntries.length,
		zeroCount: entries.filter((e) => e.amount === 0).length,
		selfCount: entries.filter((e) => e.from === e.to).length,
		inactiveIds: [...new Set(newEntries.flatMap((e) => [e.from, e.to]))].filter(
			(id) => !state.members.some((m) => m.id === id)
		)
	};
}
