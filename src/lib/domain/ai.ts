import { z } from 'zod';

export type BillScan = { billName: string; totalCost: number };

/** Structured-output schema; strict mode requires every property listed and no extras. */
export const BILL_SCAN_SCHEMA = {
	type: 'object',
	properties: {
		billName: {
			type: 'string',
			description: 'Tên hóa đơn ngắn gọn bằng tiếng Việt, ví dụ "Thịt chó ở Hoàn Béo" hoặc "Thịt chó".'
		},
		totalCost: {
			type: 'integer',
			description: 'Tổng số tiền cuối cùng phải trả, tính bằng đồng (VND), là số nguyên; 0 nếu không thấy.'
		}
	},
	required: ['billName', 'totalCost'],
	additionalProperties: false
} as const;

export const BILL_SCAN_PROMPT = [
	'Bạn đọc ảnh hóa đơn, biên lai hoặc ảnh chụp màn hình đơn đồ ăn ở Việt Nam.',
	'totalCost: tổng số tiền cuối cùng khách phải trả, bằng đồng, là số nguyên — đã trừ giảm giá và cộng thuế, phí giao hàng, phí dịch vụ. Hiểu "45k" hoặc "45.000" là 45000. Trả 0 nếu không thấy tổng tiền.',
	'billName: tên món ăn chung, kèm tên quán nếu đọc được, theo mẫu "<món> ở <tên quán>", ví dụ "Thịt chó ở Hoàn Béo".',
	'Nếu không thấy tên quán, chỉ ghi tên món, ví dụ "Thịt chó".',
	'Nếu có nhiều loại món, chọn một từ chung bao quát tất cả, ví dụ bún đậu và bún chả → "Bún".',
	'Viết hoa chữ cái đầu, tối đa 60 ký tự, không ghi giá tiền.'
].join('\n');

/** Accepts either an API base such as `https://api.openai.com/v1` or the full completions URL. */
export function chatCompletionsUrl(endpoint: string): string {
	const base = endpoint.trim().replace(/\/+$/, '');
	return base.endsWith('/chat/completions') ? base : `${base}/chat/completions`;
}

const billScanSchema = z.object({
	billName: z.string().trim().min(1).max(300),
	totalCost: z.number().nonnegative().max(1_000_000_000).transform(Math.round)
});

/** Validates model output; some compatible providers wrap JSON in a markdown fence despite the schema. */
export function parseBillScan(content: string): BillScan {
	const json = content
		.trim()
		.replace(/^```(?:json)?\s*/i, '')
		.replace(/\s*```$/, '');
	return billScanSchema.parse(JSON.parse(json));
}
