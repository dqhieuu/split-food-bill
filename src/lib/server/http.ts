import { json } from '@sveltejs/kit';
import { ZodError } from 'zod';
import { DomainError } from '$lib/domain/ledger';
export function apiError(error: unknown) {
	if (error instanceof DomainError) return json({ message: error.message }, { status: error.status });
	if (error instanceof ZodError)
		return json(
			{
				message: 'Thông tin chưa hợp lệ. Kiểm tra số tiền, ngày và các trường bắt buộc.',
				fields: error.issues.map((i) => i.path.join('.'))
			},
			{ status: 400 }
		);
	if (error instanceof SyntaxError)
		return json({ message: 'Dữ liệu không đúng định dạng JSON.' }, { status: 400 });
	console.error(error);
	return json(
		{ message: 'Không thể kết nối dữ liệu. Kiểm tra bộ giả lập Firebase rồi thử lại.' },
		{ status: 503 }
	);
}
