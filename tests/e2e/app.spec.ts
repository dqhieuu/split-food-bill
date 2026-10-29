import { test, expect, type Page } from '@playwright/test';
import { cleanupTestData } from '../../scripts/cleanup-test-data.mjs';
const API = 'http://127.0.0.1:8787';
const AN = 'discord_100000000000000001';
const LINH = 'discord_100000000000000002';
async function login(page: Page, name = 'Minh An') {
	let token = '';
	let exchange: { code: string; verifier: string } | undefined;
	page.on('request', (request) => {
		if (request.url().startsWith(API + '/api/'))
			token = request.headers().authorization?.replace('Bearer ', '') || token;
		if (request.url() === API + '/auth/exchange') exchange = request.postDataJSON();
	});
	await page.goto('/');
	await page.getByRole('button', { name: 'Đăng nhập bằng Discord', exact: true }).click();
	await page.getByRole('button', { name, exact: true }).click();
	await expect(page.locator('.account-button')).toContainText(name);
	await expect(page.locator('.loading-panel')).toHaveCount(0);
	expect(token).toBeTruthy();
	return { token, exchange, headers: { authorization: `Bearer ${token}` } };
}
async function call(page: Page, token: string, path: string, data?: unknown) {
	return page.request.fetch(API + path, {
		method: data === undefined ? 'GET' : 'POST',
		headers: { authorization: `Bearer ${token}` },
		...(data === undefined ? {} : { data })
	});
}
async function activate(page: Page, token: string, active: boolean) {
	const { state } = await (await call(page, token, '/api/groups/local/state')).json();
	const member = state.members.find((member: { id: string }) => member.id === LINH);
	expect((await call(page, token, '/api/groups/local/commands/saveMember', { ...member, active })).ok()).toBe(
		true
	);
}
test.beforeAll(async ({ request }) => {
	expect((await (await request.get(API + '/health')).json()).mode).toBe('local');
	await cleanupTestData();
});
test.afterAll(async () => {
	await cleanupTestData();
});

test('Discord OAuth handoff is single-use; unauthenticated and cross-origin requests are rejected', async ({
	page,
	request
}) => {
	expect((await request.get(API + '/api/groups/local/state')).status()).toBe(401);
	expect((await request.get(API + '/auth/callback?state=forged&code=forged')).status()).toBe(400);
	expect(
		(await request.get(API + '/api/session', { headers: { origin: 'https://evil.example' } })).status()
	).toBe(403);
	expect((await request.post('/api/demo', { data: { memberId: 'an' } })).status()).toBe(404);
	const auth = await login(page);
	const session = await (await call(page, auth.token, '/api/session')).json();
	expect(session.user.id).toBe(AN);
	expect(session.user.discordId).toBe('100000000000000001');
	expect(session.user.role).toBe('admin');
	expect((await request.post(API + '/auth/exchange', { data: auth.exchange })).status()).toBe(401);
	await page.getByRole('button', { name: 'Tài khoản', exact: true }).click();
	await page.getByRole('button', { name: 'Đăng xuất', exact: true }).click();
	await expect(page.getByRole('button', { name: 'Đăng nhập bằng Discord', exact: true })).toBeVisible();
});

test('group activation, distinct roles, group isolation and last-group selection are enforced', async ({
	page,
	browser
}) => {
	const admin = await login(page);
	const memberContext = await browser.newContext();
	const memberPage = await memberContext.newPage();
	try {
		await activate(page, admin.token, false);
		const member = await login(memberPage, 'Thảo Linh');
		await expect(
			memberPage.getByText('Bạn chưa được kích hoạt trong nhóm nào.', { exact: false })
		).toBeVisible();
		expect((await call(memberPage, member.token, '/api/discord/guilds')).status()).toBe(403);
		await expect(
			memberPage.getByRole('button', { name: 'Xóa toàn bộ cơ sở dữ liệu', exact: true })
		).toHaveCount(0);
		expect(
			(
				await call(memberPage, member.token, '/api/admin/database-reset', {
					id: crypto.randomUUID(),
					action: 'start',
					confirmation: 'XÓA TOÀN BỘ'
				})
			).status()
		).toBe(403);
		await page.getByRole('link', { name: 'Nhóm', exact: true }).click();
		await page.getByLabel('Tên nhóm', { exact: true }).fill(`E2E test group ${Date.now()}`);
		await page
			.getByRole('combobox', { name: 'Máy chủ Discord', exact: true })
			.selectOption('300000000000000002');
		await expect(page.getByText('3 thành viên trong máy chủ.', { exact: false })).toBeVisible();
		await expect(page.getByRole('button', { name: 'Làm mới danh sách Discord', exact: true })).toHaveCount(0);
		const creation = page.waitForResponse(
			(response) => response.url() === API + '/api/groups' && response.request().method() === 'POST'
		);
		await page.getByRole('button', { name: 'Tạo nhóm', exact: true }).click();
		const response = await creation;
		expect(response.status()).toBe(201);
		const { group } = await response.json();
		await expect(page.getByRole('heading', { name: 'Tài khoản của bạn', exact: true })).toBeVisible();
		await page.getByRole('link', { name: 'Tổng quan', exact: true }).click();
		await expect(page.getByRole('heading', { name: 'Tổng quan', exact: true })).toBeVisible();
		await expect(page.locator('.overview-empty')).toHaveText(['Chưa có hóa đơn.', 'Chưa có thanh toán.']);
		const emptyStyles = await page.locator('.overview-empty').evaluateAll((items) =>
			items.map((item) => {
				const style = getComputedStyle(item);
				return [style.fontSize, style.color, style.padding, style.textAlign];
			})
		);
		expect(emptyStyles[0]).toEqual(emptyStyles[1]);
		await page.getByRole('combobox', { name: 'Nhóm hiện tại', exact: true }).selectOption('local');
		await expect(page.locator('.loading-panel')).toHaveCount(0);
		await page.getByRole('link', { name: 'Nhóm', exact: true }).click();
		await page.locator('.group-choice').filter({ hasText: group.name }).click();
		await expect(page.getByRole('dialog', { name: 'Cấu hình nhóm' })).toBeVisible();
		await expect(page.getByRole('dialog').getByLabel('Máy chủ Discord', { exact: true })).toHaveValue(
			group.discordGuildId
		);
		await expect(
			page.getByRole('dialog').getByRole('combobox', { name: 'Máy chủ Discord', exact: true })
		).toBeEnabled();
		await expect(page.locator('.group-choice').filter({ hasText: group.name })).not.toContainText(
			group.discordGuildId
		);
		const renamed = group.name + ' renamed';
		await page.getByRole('dialog').getByLabel('Tên nhóm', { exact: true }).fill(renamed);
		await page.getByRole('button', { name: 'Lưu cấu hình', exact: true }).click();
		await expect(page.getByRole('dialog')).toHaveCount(0);
		await expect(page.locator('.group-choice').filter({ hasText: renamed })).toBeVisible();
		await expect(page.getByRole('combobox', { name: 'Nhóm hiện tại', exact: true })).toHaveValue('local');
		await page.locator('.group-choice').filter({ hasText: renamed }).click();
		await expect(page.getByRole('button', { name: 'Mở nhóm', exact: true })).toHaveCount(0);
		await page.keyboard.press('Escape');
		await page.getByRole('combobox', { name: 'Nhóm hiện tại', exact: true }).selectOption(group.id);
		await expect(page.locator('.loading-panel')).toHaveCount(0);
		await page.getByRole('link', { name: 'Tổng quan', exact: true }).click();
		await expect(page.getByRole('heading', { name: 'Tổng quan', exact: true })).toBeVisible();
		expect((await call(memberPage, member.token, `/api/groups/${group.id}/state`)).status()).toBe(403);
		expect(
			(await call(memberPage, member.token, `/api/groups/${group.id}/commands/createBill`, {})).status()
		).toBe(403);
		const { state } = await (await call(page, admin.token, `/api/groups/${group.id}/state`)).json();
		expect(state.members.filter((member: { active: boolean }) => member.active)).toHaveLength(1);
		expect(state.ledger).toHaveLength(0);
		const profile = state.members.find((member: { id: string }) => member.id === LINH);
		expect(
			(
				await call(page, admin.token, `/api/groups/${group.id}/commands/saveMember`, {
					...profile,
					active: true,
					role: 'admin'
				})
			).ok()
		).toBe(true);
		const active = await call(memberPage, member.token, `/api/groups/${group.id}/state`);
		expect(active.ok()).toBe(true);
		expect((await call(memberPage, member.token, `/api/discord/guilds?groupId=${group.id}`)).status()).toBe(
			200
		);
		// Group admin is still an ordinary global user and cannot create groups.
		expect(
			(
				await call(memberPage, member.token, '/api/groups', {
					name: 'forbidden',
					discordGuildId: '300000000000000001'
				})
			).status()
		).toBe(403);

		expect(
			(
				await call(
					memberPage,
					member.token,
					`/api/discord/guilds/300000000000000001/members?groupId=${group.id}`
				)
			).status()
		).toBe(403);
		const creator = state.members.find((member: { id: string }) => member.id === AN);
		const escalation = await call(memberPage, member.token, `/api/groups/${group.id}/commands/saveMember`, {
			...creator,
			bankLabel: 'Vietcombank'
		});
		// Group admins can manage group profiles, but this never modifies a global role.
		expect(escalation.ok()).toBe(true);
		expect((await (await call(memberPage, member.token, '/api/session')).json()).user.role).toBe('member');
		await page.getByRole('combobox', { name: 'Nhóm hiện tại', exact: true }).selectOption('local');
		await expect(page.locator('.breadcrumb')).toContainText('Hội ăn trưa');
		await page.getByRole('combobox', { name: 'Nhóm hiện tại', exact: true }).selectOption(group.id);
		await expect(page.locator('.breadcrumb')).toContainText(group.name);
		await page.reload();
		await expect(page.getByRole('combobox', { name: 'Nhóm hiện tại', exact: true })).toHaveValue(group.id);
		const before = (await (await call(page, admin.token, '/api/groups/local/state')).json()).state.ledger
			.length;
		const id = `e2e-isolated-${Date.now()}`;
		expect(
			(
				await call(page, admin.token, `/api/groups/${group.id}/commands/createBill`, {
					id,
					description: 'Group isolation',
					date: new Date().toISOString(),
					discordNotification: false,
					lines: [{ memberId: LINH, amount: 12345, description: 'Meal', note: '' }]
				})
			).ok()
		).toBe(true);
		expect(
			(await (await call(page, admin.token, '/api/groups/local/state')).json()).state.ledger.length
		).toBe(before);
		expect(
			(
				await call(page, admin.token, `/api/groups/${group.id}/commands/saveMember`, {
					...profile,
					active: false
				})
			).ok()
		).toBe(true);
		expect((await call(memberPage, member.token, `/api/groups/${group.id}/state`)).status()).toBe(403);
		expect(
			(
				await call(memberPage, member.token, `/api/groups/${group.id}/commands/saveMember`, {
					...profile,
					active: true
				})
			).status()
		).toBe(403);
	} finally {
		await call(page, admin.token, '/api/groups/local/select', {});
		await memberContext.close();
	}
});

test('bill creation, profile editing and detail dialogs work with scoped Discord identities', async ({
	page
}) => {
	const admin = await login(page);
	try {
		await activate(page, admin.token, true);
		await page.reload();
		await page.getByRole('link', { name: 'Tạo hoá đơn', exact: true }).first().click();
		const title = `Bữa trưa kiểm thử ${Date.now()}`;
		await page.getByLabel('Ngày thanh toán', { exact: true }).fill('2026-10-25');
		await expect(page.locator('.bill-date-label')).toContainText('Chủ Nhật');
		const money = page.getByRole('textbox', { name: 'Giá sau khi giảm giá', exact: true });
		await money.fill('12.5');
		await money.press('e');
		await expect(money).toHaveValue('12.5');
		await money.fill('');
		await page.getByRole('textbox', { name: 'Tên hóa đơn', exact: true }).fill(title);
		await expect(page.getByRole('switch', { name: 'Gửi thông báo qua Discord', exact: true })).toBeChecked();
		await page.getByRole('button', { name: 'Chọn tất cả', exact: true }).click();
		for (const button of await page.locator('.member-picker button').all()) {
			const name = await button.innerText();
			if (!name.includes('Minh An') && !name.includes('Thảo Linh')) await button.click();
		}
		await page.getByRole('button', { name: 'Chia đều', exact: true }).click();
		await page.getByRole('textbox', { name: 'Tổng tiền cần chia', exact: true }).fill('100.001');
		await page.getByRole('button', { name: 'Xem lại hóa đơn', exact: true }).click();
		await expect(page.getByRole('dialog')).toContainText('51.000');
		await page.getByRole('button', { name: 'Xem trước Discord', exact: true }).click();
		await expect(page.getByRole('dialog', { name: 'Xem trước Discord', exact: true })).toContainText(
			'Bạn phải trả: 51.000 ₫'
		);
		await expect(page.locator('.discord-preview')).toContainText('Người khác:');
		await expect(page.locator('.discord-preview a')).toHaveAttribute('href', /\/balances\?group=local&to=/);
		await page.keyboard.press('Escape');
		await page.getByRole('button', { name: 'Xác nhận', exact: true }).click();
		await expect(page.locator('.data-table tbody tr').first()).toContainText(title);
		const row = page.getByRole('row').filter({ hasText: title });
		await row.locator('td').nth(3).click();
		await expect(page.getByRole('dialog')).toContainText('102.000');
		await expect(page.locator('.receipt-detail')).toHaveCount(0);

		await page.keyboard.press('Escape');
		await page.getByRole('link', { name: 'Tổng quan', exact: true }).click();
		await expect(page.locator('.recent-panel .bill-row').first()).toContainText(title);
		await page.locator('.recent-panel .bill-row').first().click();
		await expect(page).toHaveURL('http://127.0.0.1:5173/');
		await page.keyboard.press('Escape');
		await page.locator('.calendar-panel .cal-bill').first().click();
		await expect(page.getByRole('dialog')).toBeVisible();
		await page.keyboard.press('Escape');
		await page.getByRole('link', { name: 'Thành viên & quản lý', exact: true }).click();
		await expect(page.getByRole('button', { name: 'Làm mới thành viên Discord', exact: true })).toBeVisible();
		await expect(page.getByRole('button', { name: 'Thêm thành viên', exact: true })).toHaveCount(0);
		await expect(page.locator('.data-table tbody tr').first()).toContainText('Minh An');
		await expect(page.getByRole('switch', { name: 'Kích hoạt Minh An', exact: true })).toBeDisabled();
		const activation = page.getByRole('switch', { name: 'Kích hoạt Thảo Linh', exact: true });
		await activation.uncheck();
		await expect(page.getByRole('row').filter({ hasText: 'Thảo Linh' })).toHaveClass(/inactive-member/);
		await activation.check();
		await expect(page.getByRole('row').filter({ hasText: 'Thảo Linh' })).not.toHaveClass(/inactive-member/);
		await page.getByRole('button', { name: 'Sửa hồ sơ Thảo Linh', exact: true }).click();
		await expect(page.getByLabel('ID', { exact: true })).toBeDisabled();
		await expect(page.getByLabel('Email', { exact: true })).toHaveCount(0);
		await expect(page.locator('#member-bank-options option')).toHaveCount(68);
		await expect(page.locator('#member-bank-options option[value="Woori"]')).toHaveCount(1);
		await page.getByLabel('Ngân hàng', { exact: true }).fill('Ngân hàng TMCP Kiên Long');
		await page.getByLabel('Số tài khoản', { exact: true }).fill('linh.account-01');
		await page.getByRole('button', { name: 'Lưu hồ sơ', exact: true }).click();
		await expect(page.getByRole('dialog')).toHaveCount(0);
		await expect(page.getByRole('row').filter({ hasText: 'Thảo Linh' })).toContainText('KienLongBank');
		await page.getByRole('button', { name: 'Sửa hồ sơ Thảo Linh', exact: true }).click();
		await expect(page.getByLabel('Ngân hàng', { exact: true })).toHaveValue('KienLongBank');
		await expect(page.getByLabel('Số tài khoản', { exact: true })).toHaveValue('linh.account-01');
		await page.keyboard.press('Escape');
		await page.setViewportSize({ width: 390, height: 844 });
		expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
	} finally {
		await activate(page, admin.token, false);
	}
});

test('system reset requires confirmation and can be cancelled without deleting data', async ({ page }) => {
	await login(page);
	let resetRequests = 0;
	page.on('request', (request) => {
		if (request.url() === API + '/api/admin/database-reset') resetRequests++;
	});
	await page.getByRole('button', { name: 'Tài khoản', exact: true }).click();
	await expect(page.getByRole('dialog')).not.toContainText(AN);
	await expect(page.getByRole('dialog')).toContainText('Quản trị viên hệ thống');
	await page.keyboard.press('Escape');
	await page.getByRole('link', { name: 'Nhóm', exact: true }).click();
	await page.getByRole('button', { name: 'Xóa toàn bộ cơ sở dữ liệu', exact: true }).click();
	const submit = page.getByRole('button', { name: 'Xóa toàn bộ dữ liệu', exact: true });
	await expect(submit).toBeDisabled();
	await page.getByRole('textbox', { name: 'Xác nhận xóa cơ sở dữ liệu', exact: true }).fill('XÓA TOÀN BỘ');
	await expect(submit).toBeEnabled();
	await page.getByRole('button', { name: 'Đóng', exact: true }).first().click();
	await expect(page.getByRole('dialog')).toHaveCount(0);
	expect(resetRequests).toBe(0);
});

test('ordinary bill creators notify participants once; opt-out and notification permissions are enforced', async ({
	page,
	browser
}) => {
	const admin = await login(page);
	const context = await browser.newContext();
	const memberPage = await context.newPage();
	try {
		await activate(page, admin.token, true);
		const member = await login(memberPage, 'Thảo Linh');
		await memberPage.getByRole('link', { name: 'Nhóm', exact: true }).click();
		await expect(memberPage.locator('.group-choice').first()).toBeDisabled();
		expect((await call(memberPage, member.token, '/api/discord/guilds?groupId=local')).status()).toBe(403);
		expect(
			(
				await call(memberPage, member.token, '/api/groups/local/commands/configureGroup', {
					name: 'Forbidden edit',
					discordGuildId: '300000000000000002'
				})
			).status()
		).toBe(403);
		const input = {
			id: `e2e-notification-${Date.now()}`,
			description: `Bữa trưa kiểm thử ${Date.now()}`,
			date: new Date().toISOString(),
			discordNotification: true,
			lines: [
				{ memberId: LINH, amount: 35000, description: 'Cơm', note: '' },
				{ memberId: AN, amount: 45000, description: 'Phở', note: '' }
			]
		};
		const response = await call(memberPage, member.token, '/api/groups/local/commands/createBill', input);
		expect(response.ok()).toBe(true);
		const first = await response.json();
		await memberPage.goto(`/activity?bill=${input.id}`);
		await expect(memberPage.getByRole('button', { name: 'Hoàn tác hóa đơn', exact: true })).toBeVisible();
		await page.goto(`/activity?bill=${input.id}`);
		await expect(page.getByRole('button', { name: 'Hoàn tác hóa đơn', exact: true })).toBeVisible();
		const otherBill = first.state.bills.find((bill: { organizer: string }) => bill.organizer === AN);
		await memberPage.goto(`/activity?bill=${otherBill.id}`);
		await expect(memberPage.getByRole('dialog')).toBeVisible();
		await expect(memberPage.getByRole('button', { name: 'Hoàn tác hóa đơn', exact: true })).toHaveCount(0);
		expect(
			(
				await call(memberPage, member.token, '/api/groups/local/commands/undoBill', { id: otherBill.id })
			).status()
		).toBe(403);
		const receipt = first.state.receipts.find((receipt: { id: string }) => receipt.id === input.id);
		expect(receipt).toMatchObject({ recipients: [LINH, AN], status: 'simulated', attempts: 1 });
		expect(receipt.deliveries).toHaveLength(2);
		await call(memberPage, member.token, '/api/groups/local/commands/createBill', input);
		const retry = await call(memberPage, member.token, '/api/discord/dm', {
			groupId: 'local',
			billId: input.id
		});
		expect(retry.ok()).toBe(true);
		const replayed = (await retry.json()).state;
		expect(replayed.receipts.find((item: { id: string }) => item.id === input.id).attempts).toBe(1);
		expect(replayed.bills.filter((item: { id: string }) => item.id === input.id)).toHaveLength(1);
		expect(
			replayed.ledger.filter((entry: { reference: string }) => entry.reference === input.id)
		).toHaveLength(1);
		const optedOut = { ...input, id: input.id + '-off', discordNotification: false };
		const saved = await (
			await call(page, admin.token, '/api/groups/local/commands/createBill', optedOut)
		).json();
		expect(saved.state.receipts.some((item: { id: string }) => item.id === optedOut.id)).toBe(false);
		expect(
			(
				await call(memberPage, member.token, '/api/discord/dm', { groupId: 'local', billId: optedOut.id })
			).status()
		).toBe(403);
		expect(
			(
				await call(memberPage, member.token, '/api/discord/dm', {
					groupId: 'local',
					billId: input.id,
					recipients: [AN],
					message: 'arbitrary text'
				})
			).status()
		).toBe(400);
	} finally {
		await activate(page, admin.token, false);
		await context.close();
	}
});

test('repayment links survive login and the mobile skip link only appears with keyboard focus', async ({
	page
}) => {
	await page.setViewportSize({ width: 390, height: 844 });
	const target = 'discord_100000000000000003';
	let payments = 0;
	page.on('request', (request) => {
		if (request.url().includes('/commands/confirmQrPayment')) payments++;
	});
	// Isolate the repayment preview from the demo group's changing debt and activation state.
	await page.route('**/api/groups/local/state*', async (route) => {
		const response = await route.fetch();
		const data = await response.json();
		if (data.state) {
			data.state.members.find((member: { id: string }) => member.id === target).active = true;
			data.state.ledger = [
				{
					id: 'preview-debt',
					from: AN,
					to: target,
					type: 'debt',
					amount: 55000,
					date: '2026-10-27T05:00:00Z',
					description: 'Preview',
					note: '',
					creator: target,
					source: 'bill',
					reference: 'preview-bill'
				}
			];
		}
		await route.fulfill({ response, json: data });
	});
	await page.goto(`/balances?group=local&to=${target}`);
	await page.getByRole('button', { name: 'Đăng nhập bằng Discord', exact: true }).click();
	await page.getByRole('button', { name: 'Minh An', exact: true }).click();
	await expect(page.getByRole('dialog', { name: 'Chuyển tiền bằng QR', exact: true })).toBeVisible();
	await expect(page.getByRole('dialog')).toContainText('55.000');
	await expect(page).toHaveURL(`http://127.0.0.1:5173/balances?group=local&to=${target}`);
	await page.keyboard.press('Escape');
	const skip = page.locator('.skip-link');
	const hidden = (await skip.boundingBox())!;
	expect(hidden.y + hidden.height).toBeLessThanOrEqual(0);
	await page.keyboard.press('Tab');
	await skip.focus();
	expect((await skip.boundingBox())!.y).toBeGreaterThanOrEqual(0);
	expect(payments).toBe(0);
});

test('AI scans an existing attachment once, highlights changes, and preserves the date when absent', async ({
	page
}) => {
	await page.route('**/api/groups/*/state*', async (route) => {
		const response = await route.fetch();
		const data = await response.json();
		data.group.aiEnabled = true;
		await route.fulfill({ response, json: data });
	});
	let uploads = 0;
	let scans = 0;
	await page.route('**/api/groups/*/images', (route) => {
		uploads++;
		return route.fulfill({ json: { imageId: `3f2504e0-4f89-41d3-9a0c-0305e82c330${uploads}.png` } });
	});
	const image = await page.screenshot({ type: 'png' });
	await page.route('**/api/groups/*/images/*', (route) =>
		route.fulfill({ contentType: 'image/png', body: image })
	);
	await page.route('**/api/groups/*/ai/scan', (route) => {
		scans++;
		return route.fulfill({
			json: { billName: 'Cơm trưa AI', totalCost: 165000, billDate: scans === 1 ? '2026-10-25' : null }
		});
	});
	await login(page);
	await page.getByRole('link', { name: 'Tạo hoá đơn', exact: true }).first().click();
	await page.getByLabel('Ngày thanh toán', { exact: true }).fill('2026-10-27');
	await page.getByLabel('Tên hóa đơn', { exact: true }).fill('Original');
	const attach = () =>
		page
			.getByLabel('Chọn ảnh hóa đơn', { exact: true })
			.setInputFiles({ name: 'receipt.png', mimeType: 'image/png', buffer: image });
	await attach();
	await page.getByRole('button', { name: 'Đọc hóa đơn bằng AI', exact: true }).click();
	await expect(page.getByRole('button', { name: 'AI đã đọc hóa đơn', exact: true })).toBeDisabled();
	await expect(page.locator('.ai-scan-complete')).toBeVisible();
	await expect(page.getByLabel('Tên hóa đơn', { exact: true })).toHaveValue('Cơm trưa AI');
	await expect(page.getByLabel('Ngày thanh toán', { exact: true })).toHaveValue('2026-10-25');
	await expect(page.getByLabel('Tổng tiền cần chia', { exact: true })).toHaveValue('165');
	await expect(page.locator('.ai-updated')).toHaveCount(3);
	for (const field of await page.locator('.ai-updated').all()) {
		const shadow = await field
			.locator(':scope > input, :scope > .bill-date-control, :scope > .money-input > input')
			.evaluate((element) => getComputedStyle(element).boxShadow);
		expect(shadow).not.toBe('none');
	}
	await page.screenshot({ path: 'artifacts/ai-bill-scan.png', fullPage: true });
	expect(uploads).toBe(1);
	expect(scans).toBe(1);
	await page.getByLabel('Ngày thanh toán', { exact: true }).fill('2026-10-26');
	await attach();
	await expect(page.locator('.ai-updated')).toHaveCount(0);
	await page.getByRole('button', { name: 'Đọc hóa đơn bằng AI', exact: true }).click();
	await expect(page.getByRole('button', { name: 'AI đã đọc hóa đơn', exact: true })).toBeDisabled();
	await expect(page.getByLabel('Ngày thanh toán', { exact: true })).toHaveValue('2026-10-26');
	expect(uploads).toBe(2);
	expect(scans).toBe(2);
	await page.evaluate(() =>
		Object.keys(localStorage)
			.filter((key) => key.startsWith('lunchroom-draft-'))
			.forEach((key) => localStorage.removeItem(key))
	);
});
