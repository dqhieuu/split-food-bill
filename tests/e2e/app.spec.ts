import { test, expect } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import { cleanupTestData } from '../../scripts/cleanup-test-data.mjs';

test.afterAll(async () => {
	await cleanupTestData();
});

test('Vietnamese navigation, bill posting, receipt retry, payments and mobile layout', async ({ page }) => {
	const errors: string[] = [];
	page.on('pageerror', (error) => errors.push(error.message));
	await page.setViewportSize({ width: 1440, height: 1000 });
	await page.goto('/');
	await expect(page.getByRole('heading', { name: /Chào An/ })).toBeVisible();
	await mkdir('artifacts', { recursive: true });
	await page.screenshot({ path: 'artifacts/overview-desktop.png', fullPage: true });
	for (const name of ['Ghi thanh toán', 'Số dư cá nhân', 'Ma trận công nợ', 'Chỉ số thanh toán'])
		await expect(page.getByRole('link', { name, exact: true })).toBeVisible();
	await page.getByRole('link', { name: 'Ghi thanh toán', exact: true }).click();
	const title = `Bữa trưa kiểm thử ${Date.now()}`;
	await page.getByRole('textbox', { name: 'Tên hóa đơn', exact: true }).fill(title);
	await page.getByRole('button', { name: 'Chọn cả nhóm', exact: true }).click();
	await page.getByRole('button', { name: 'Chia đều', exact: true }).click();
	await page.getByRole('spinbutton', { name: /Tổng tiền cần chia/ }).fill('440.001');
	await page.reload();
	await expect(page.getByRole('textbox', { name: 'Tên hóa đơn', exact: true })).toHaveValue(title);
	await page.getByRole('button', { name: 'Xem lại hóa đơn', exact: true }).click();
	await expect(page.getByRole('dialog')).toContainText('440.001');
	await page.getByRole('button', { name: 'Xác nhận ghi hóa đơn', exact: true }).click();
	await expect(page).toHaveURL(/\/activity/);
	await page
		.getByRole('button', { name: new RegExp(title) })
		.first()
		.click();
	await expect(page.getByRole('dialog').first()).toContainText('440.001');
	await page.getByRole('button', { name: 'Mô phỏng lỗi', exact: true }).click();
	await expect(page.getByRole('dialog').first()).toContainText('Mô phỏng thất bại');
	await page.getByRole('button', { name: 'Thử lại mô phỏng', exact: true }).click();
	await expect(page.getByRole('dialog').first()).toContainText('Đã mô phỏng');
	await page.getByRole('button', { name: 'Xem email', exact: true }).click();
	await expect(
		page.frameLocator('iframe').getByRole('heading', { name: 'Bữa ngon, chia thật gọn.' })
	).toBeVisible();
	await page.keyboard.press('Escape');
	await page.keyboard.press('Escape');
	await page.getByRole('link', { name: 'Số dư cá nhân', exact: true }).click();
	await page.getByRole('button', { name: 'Ghi khoản hoàn tiền', exact: true }).click();
	await page.getByRole('spinbutton', { name: 'Số tiền (đồng)', exact: true }).fill('1000');
	await page.getByRole('button', { name: 'Thêm người nhận', exact: true }).click();
	await page.getByRole('spinbutton', { name: 'Số tiền người nhận 2 (đồng)', exact: true }).fill('2000');
	await page.getByRole('textbox', { name: 'Nội dung', exact: true }).fill('Hoàn tiền kiểm thử tự động');
	await page.getByRole('button', { name: 'Xem lại', exact: true }).click();
	await page.getByRole('button', { name: 'Xác nhận đã trả', exact: true }).click();
	await expect(page.getByRole('dialog')).toHaveCount(0);
	await page.getByRole('link', { name: 'Chỉ số thanh toán', exact: true }).click();
	await expect(page.getByRole('heading', { name: 'Diễn biến số dư ròng' })).toBeVisible();
	await page.getByRole('link', { name: 'Ma trận công nợ', exact: true }).click();
	await page.getByRole('button', { name: 'Điều phối công nợ', exact: true }).click();
	await expect(page.getByRole('dialog')).toContainText('không tạo khoản nợ cho chính mình');
	await page.keyboard.press('Escape');
	await page.setViewportSize({ width: 390, height: 844 });
	await page.getByRole('button', { name: 'Mở trình đơn', exact: true }).click();
	await page.getByRole('link', { name: 'Tổng quan', exact: true }).click();
	await expect(page.locator('aside')).toHaveCSS('visibility', 'hidden');
	await expect(page.getByRole('heading', { name: /Chào An/ })).toBeVisible();
	expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
	await page.screenshot({ path: 'artifacts/overview-mobile.png', fullPage: true });
	expect(errors).toEqual([]);
});

test('API authenticates actors and serializes concurrent duplicate bill requests', async ({ request }) => {
	await request.get('/api/demo');
	const account = await (await request.post('/api/demo', { data: { memberId: 'an' } })).json();
	const auth = await request.post(
		'http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=demo-lunchroom-key',
		{ data: { email: account.email, password: account.password, returnSecureToken: true } }
	);
	const { idToken } = await auth.json();
	const headers = { authorization: `Bearer ${idToken}` };
	const id = `concurrent-${Date.now()}`;
	const data = {
		id,
		description: 'Concurrent test',
		date: new Date().toISOString(),
		emailReceipt: true,
		lines: [{ memberId: 'linh', amount: 12345, description: 'Test', note: '' }]
	};
	const responses = await Promise.all([
		request.post('/api/commands/createBill', { headers, data }),
		request.post('/api/commands/createBill', { headers, data })
	]);
	expect(responses.every((r) => r.ok())).toBe(true);
	const { state } = await (await request.get('/api/state', { headers })).json();
	expect(state.bills.filter((b: { id: string }) => b.id === id)).toHaveLength(1);
	expect(state.ledger.filter((e: { reference: string }) => e.reference === id)).toHaveLength(1);
	expect((await request.post('/api/commands/createBill', { data })).status()).toBe(401);
	const memberAccount = await (await request.post('/api/demo', { data: { memberId: 'linh' } })).json();
	const memberToken = await (
		await request.post(
			'http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=demo-lunchroom-key',
			{ data: { email: memberAccount.email, password: memberAccount.password, returnSecureToken: true } }
		)
	).json();
	expect(
		(
			await request.post('/api/commands/settleDebts', {
				headers: { authorization: `Bearer ${memberToken.idToken}` },
				data: { id: 'unauthorized', version: state.version }
			})
		).status()
	).toBe(403);
});

test('QR confirmation, import preview, member editing and meal planning work against the emulators', async ({
	page,
	request
}) => {
	async function tokenFor(memberId: string) {
		const account = await (await request.post('/api/demo', { data: { memberId } })).json();
		const token = await (
			await request.post(
				'http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=demo-lunchroom-key',
				{ data: { email: account.email, password: account.password, returnSecureToken: true } }
			)
		).json();
		return { authorization: `Bearer ${token.idToken}` };
	}
	await request.get('/api/demo');
	const adminHeaders = await tokenFor('an');
	const memberId = `e2e-person-${Date.now()}`;
	expect(
		(
			await request.post('/api/commands/saveMember', {
				headers: adminHeaders,
				data: {
					id: memberId,
					name: 'Thành viên kiểm thử QR',
					email: `${memberId}@example.test`,
					team: 'Kiểm thử',
					active: true,
					role: 'member',
					bankCode: '970436',
					bankAccount: '000000000001',
					bankName: 'TAI KHOAN MAU',
					color: '#5e8067'
				}
			})
		).ok()
	).toBe(true);
	const memberHeaders = await tokenFor(memberId);
	expect(
		(
			await request.post('/api/commands/createBill', {
				headers: memberHeaders,
				data: {
					id: `e2e-qr-bill-${Date.now()}`,
					description: 'Kiểm thử QR',
					date: new Date().toISOString(),
					emailReceipt: false,
					lines: [{ memberId: 'an', amount: 6789, description: 'Bữa trưa thử nghiệm', note: '' }]
				}
			})
		).ok()
	).toBe(true);
	await page.goto('/balances');
	const counterpart = page.locator('.counterpart').filter({ hasText: 'Thành viên kiểm thử QR' });
	await counterpart.getByRole('button', { name: 'Mã QR', exact: true }).click();
	await expect(page.getByRole('img', { name: 'Mã VietQR cho khoản thanh toán thử nghiệm' })).toBeVisible();
	await expect(page.getByRole('button', { name: 'Đã thanh toán', exact: true })).toBeDisabled();
	await page.getByRole('checkbox', { name: 'Tôi xác nhận đã chuyển khoản', exact: true }).check();
	await page.getByRole('button', { name: 'Đã thanh toán', exact: true }).click();
	await expect(page.getByRole('dialog')).toHaveCount(0);
	await expect(counterpart).toHaveCount(0);
	await page.getByRole('link', { name: 'Thành viên & quản lý', exact: true }).click();
	await page.getByRole('button', { name: 'Sửa hồ sơ Thành viên kiểm thử QR', exact: true }).click();
	await page.getByRole('textbox', { name: 'Nhóm', exact: true }).fill('Nhóm kiểm thử đã sửa');
	await page.getByRole('button', { name: 'Lưu hồ sơ', exact: true }).click();
	await expect(page.getByRole('cell', { name: 'Nhóm kiểm thử đã sửa' })).toBeVisible();
	await page.getByRole('button', { name: 'Dữ liệu & lưu trữ', exact: true }).click();
	await page.getByRole('button', { name: 'Kiểm tra tệp nhập', exact: true }).click();
	const importId = `e2e-import-${Date.now()}`;
	await page.getByLabel('Chọn tệp sổ giao dịch').setInputFiles({
		name: 'history.json',
		mimeType: 'application/json',
		buffer: Buffer.from(
			JSON.stringify([
				{
					id: importId,
					from: memberId,
					to: 'an',
					type: 'debt',
					amount: 0,
					date: new Date().toISOString(),
					description: 'Nhập lịch sử kiểm thử',
					note: '',
					legacySequence: 'qa-1'
				}
			])
		)
	});
	await expect(page.getByRole('dialog')).toContainText('Giữ 1 dòng 0 đồng');
	await page.getByRole('checkbox', { name: 'Tôi đã kiểm tra dữ liệu và muốn nhập vào sổ cục bộ.' }).check();
	await page.getByRole('button', { name: 'Xác nhận nhập lịch sử', exact: true }).click();
	await expect(page.getByRole('dialog').getByRole('status')).toContainText('Hoàn tất');
	await page.keyboard.press('Escape');
	await page.getByRole('link', { name: 'Tuần này ăn gì?', exact: true }).click();
	await page.getByRole('button', { name: 'Gợi ý thực đơn', exact: true }).click();
	await expect(page.getByRole('textbox', { name: 'Món ăn Thứ hai', exact: true })).toBeVisible();
	await page.getByRole('button', { name: 'Hủy chỉnh sửa', exact: true }).click();
});
