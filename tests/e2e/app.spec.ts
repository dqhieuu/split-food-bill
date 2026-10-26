import { test, expect } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import { cleanupTestData } from '../../scripts/cleanup-test-data.mjs';

test.afterAll(async () => {
	await cleanupTestData();
});

test('Vietnamese navigation, bill posting, receipt retry and mobile layout', async ({ page }) => {
	const errors: string[] = [];
	page.on('pageerror', (error) => errors.push(error.message));
	await page.setViewportSize({ width: 1440, height: 1000 });
	await page.goto('/');
	await expect(page.getByRole('heading', { name: 'Tổng quan', exact: true })).toBeVisible();
	// Calendar indicator: one solid colour per bar, fixed 158px cells.
	await expect(page.locator('.cal-day').first()).toBeVisible();
	const calendar = await page.evaluate(() => ({
		bars: [...document.querySelectorAll<HTMLElement>('.cal-track > span')].map((bar) => ({
			image: getComputedStyle(bar).backgroundImage,
			color: getComputedStyle(bar).backgroundColor,
			width: bar.style.width
		})),
		heights: [
			...new Set([...document.querySelectorAll('.cal-day')].map((c) => c.getBoundingClientRect().height))
		]
	}));
	expect(calendar.heights).toEqual([158]);
	for (const bar of calendar.bars) {
		expect(bar.image).toBe('none');
		expect(bar.color).toMatch(/^rgb\(\d+, \d+, \d+\)$/);
		expect(bar.width).toMatch(/^\d+%$/);
	}
	await mkdir('artifacts', { recursive: true });
	await page.screenshot({ path: 'artifacts/overview-desktop.png', fullPage: true });
	for (const name of ['Ghi thanh toán', 'Số dư cá nhân', 'Ma trận nợ nần', 'Tiền ăn index'])
		await expect(page.getByRole('link', { name, exact: true })).toBeVisible();
	await page.getByRole('link', { name: 'Ghi thanh toán', exact: true }).click();
	const title = `Bữa trưa kiểm thử ${Date.now()}`;
	await page.getByRole('textbox', { name: 'Tên hóa đơn', exact: true }).fill(title);
	await page.getByRole('button', { name: 'Chọn tất cả', exact: true }).click();
	await page.getByRole('button', { name: 'Chia đều', exact: true }).click();
	await page.getByRole('spinbutton', { name: /Tổng tiền cần chia/ }).fill('440.001');
	await page.reload();
	await expect(page.getByRole('textbox', { name: 'Tên hóa đơn', exact: true })).toHaveValue(title);
	await page.getByRole('button', { name: 'Xem lại hóa đơn', exact: true }).click();
	// Equal shares round up to 100 ₫ by default: 440.001 ₫ / 8 → 55.100 ₫ each.
	await expect(page.getByRole('dialog')).toContainText('55.100');
	await expect(page.getByRole('dialog')).toContainText('440.800');
	await page.getByRole('button', { name: 'Xác nhận', exact: true }).click();
	await expect(page).toHaveURL(/\/activity/);
	await page
		.getByRole('button', { name: new RegExp(title) })
		.first()
		.click();
	await expect(page.getByRole('dialog').first()).toContainText('440.800');
	await page.getByRole('button', { name: 'Mô phỏng lỗi', exact: true }).click();
	await expect(page.getByRole('dialog').first()).toContainText('Mô phỏng thất bại');
	await page.getByRole('button', { name: 'Thử lại mô phỏng', exact: true }).click();
	await expect(page.getByRole('dialog').first()).toContainText('Đã mô phỏng');
	await page.getByRole('button', { name: 'Xem email', exact: true }).click();
	await expect(page.frameLocator('iframe').getByRole('heading', { name: 'Biên nhận hóa đơn' })).toBeVisible();
	await page.keyboard.press('Escape');
	await page.keyboard.press('Escape');
	await page.getByRole('link', { name: 'Số dư cá nhân', exact: true }).click();
	await page.getByRole('link', { name: 'Tiền ăn index', exact: true }).click();
	await expect(page.getByRole('heading', { name: 'Chỉ số các mã ĂT trong vòng 15 ngày' })).toBeVisible();
	await page.getByRole('link', { name: 'Ma trận nợ nần', exact: true }).click();
	await page.getByRole('button', { name: 'Tối giản nợ', exact: true }).click();
	await expect(page.getByRole('dialog')).toContainText('bản ghi trong Ledger');
	await page.keyboard.press('Escape');
	await page.setViewportSize({ width: 390, height: 844 });
	await page.getByRole('button', { name: 'Mở trình đơn', exact: true }).click();
	await page.getByRole('link', { name: 'Tổng quan', exact: true }).click();
	await expect(page.locator('aside')).toHaveCSS('visibility', 'hidden');
	await expect(page.getByRole('heading', { name: 'Tổng quan', exact: true })).toBeVisible();
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

test('QR confirmation, import preview, member editing work against the emulators', async ({
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
	const qrCommands: string[] = [];
	page.on('request', (request) => {
		if (new URL(request.url()).pathname.startsWith('/api/commands/')) qrCommands.push(request.url());
	});
	await counterpart.getByRole('button', { name: 'Mã QR', exact: true }).click();
	await expect(page.getByRole('img', { name: 'Mã VietQR cho khoản thanh toán thử nghiệm' })).toBeVisible();
	expect(qrCommands).toEqual([]);
	await page
		.getByRole('dialog')
		.locator('.modal-actions')
		.getByRole('button', { name: 'Đóng', exact: true })
		.click();
	expect(qrCommands).toEqual([]);
	await counterpart.getByRole('button', { name: 'Mã QR', exact: true }).click();
	await expect(page.getByRole('img', { name: 'Mã VietQR cho khoản thanh toán thử nghiệm' })).toBeVisible();
	expect(qrCommands).toEqual([]);
	await expect(page.getByRole('button', { name: 'Đã thanh toán', exact: true })).toBeDisabled();
	await page.getByRole('checkbox', { name: 'Đã chuyển khoản xong', exact: true }).check();
	await page.getByRole('button', { name: 'Đã thanh toán', exact: true }).click();
	await expect(page.getByRole('dialog')).toHaveCount(0);
	expect(qrCommands).toHaveLength(1);
	expect(qrCommands[0]).toMatch(/\/confirmQrPayment$/);
	// Settled counterparts stay listed under "Tất cả" as "Bạn đang lãi 0 ₫".
	await expect(counterpart).toContainText('Bạn đang lãi');
	await expect(counterpart).toContainText('0 ₫');
	await expect(counterpart.getByRole('button', { name: 'Mã QR', exact: true })).toHaveCount(0);
	await page.getByRole('link', { name: 'Thành viên & quản lý', exact: true }).click();
	await page.getByRole('button', { name: 'Sửa hồ sơ Thành viên kiểm thử QR', exact: true }).click();
	await page.getByRole('textbox', { name: 'Tên', exact: true }).fill('Thành viên kiểm thử QR đã sửa');
	await page.getByLabel('Ngân hàng', { exact: true }).fill('Ngân hàng nội bộ');
	await page.getByRole('button', { name: 'Lưu hồ sơ', exact: true }).click();
	await expect(page.getByText('Thành viên kiểm thử QR đã sửa', { exact: true })).toBeVisible();
	await expect(page.getByRole('row').filter({ hasText: 'Thành viên kiểm thử QR đã sửa' })).toContainText(
		'Ngân hàng nội bộ'
	);
	await page.getByRole('button', { name: 'Sửa hồ sơ Thành viên kiểm thử QR đã sửa', exact: true }).click();
	await expect(page.getByLabel('Ngân hàng', { exact: true })).toHaveValue('Ngân hàng nội bộ');
	await page.getByLabel('Ngân hàng', { exact: true }).fill('vIeTcOmBaNk');
	await page.getByRole('button', { name: 'Lưu hồ sơ', exact: true }).click();
	await expect(page.getByRole('row').filter({ hasText: 'Thành viên kiểm thử QR đã sửa' })).toContainText(
		'Vietcombank'
	);
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
});
