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
		expect((await call(memberPage, member.token, '/api/discord/channels')).status()).toBe(403);
		await page.getByRole('link', { name: 'Nhóm', exact: true }).click();
		await page.getByLabel('Tên nhóm', { exact: true }).fill(`E2E test group ${Date.now()}`);
		await page
			.getByRole('combobox', { name: 'Kênh Discord', exact: true })
			.selectOption('200000000000000002');
		await expect(page.getByText('3 người có quyền xem kênh.', { exact: false })).toBeVisible();
		const creation = page.waitForResponse(
			(response) => response.url() === API + '/api/groups' && response.request().method() === 'POST'
		);
		await page.getByRole('button', { name: 'Tạo nhóm', exact: true }).click();
		const response = await creation;
		expect(response.status()).toBe(201);
		const { group } = await response.json();
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
		// Group admin is still an ordinary global user and cannot create groups.
		expect(
			(
				await call(memberPage, member.token, '/api/groups', {
					name: 'forbidden',
					discordChannelId: '200000000000000001'
				})
			).status()
		).toBe(403);
		const dmRequest = {
			id: crypto.randomUUID(),
			groupId: group.id,
			recipients: [AN],
			message: 'Local mock only'
		};
		const dm = await call(memberPage, member.token, '/api/discord/dm', dmRequest);
		expect(dm.ok()).toBe(true);
		expect((await dm.json()).results[0].status).toBe('simulated');
		expect((await call(memberPage, member.token, '/api/discord/dm', dmRequest)).status()).toBe(409);
		expect(
			(
				await call(
					memberPage,
					member.token,
					`/api/discord/channels/200000000000000001/members?groupId=${group.id}`
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
					emailReceipt: false,
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
		await page.getByRole('button', { name: 'Chọn tất cả', exact: true }).click();
		for (const button of await page.locator('.member-picker button').all()) {
			const name = await button.innerText();
			if (!name.includes('Minh An') && !name.includes('Thảo Linh')) await button.click();
		}
		await page.getByRole('button', { name: 'Chia đều', exact: true }).click();
		await page.getByRole('textbox', { name: 'Tổng tiền cần chia', exact: true }).fill('100.001');
		await page.getByRole('button', { name: 'Xem lại hóa đơn', exact: true }).click();
		await expect(page.getByRole('dialog')).toContainText('51.000');
		await page.getByRole('button', { name: 'Xác nhận', exact: true }).click();
		const row = page.getByRole('row').filter({ hasText: title });
		await row.locator('td').nth(3).click();
		await expect(page.getByRole('dialog')).toContainText('102.000');
		await page.getByRole('button', { name: 'Mô phỏng lỗi', exact: true }).click();
		await page.getByRole('button', { name: 'Thử lại mô phỏng', exact: true }).click();
		await page.keyboard.press('Escape');
		await page.getByRole('link', { name: 'Tổng quan', exact: true }).click();
		await page.locator('.recent-panel .bill-row').first().click();
		await expect(page).toHaveURL('http://127.0.0.1:5173/');
		await page.keyboard.press('Escape');
		await page.locator('.calendar-panel .cal-bill').first().click();
		await expect(page.getByRole('dialog')).toBeVisible();
		await page.keyboard.press('Escape');
		await page.getByRole('link', { name: 'Thành viên & quản lý', exact: true }).click();
		await expect(page.getByRole('button', { name: 'Đồng bộ Discord', exact: true })).toBeVisible();
		await expect(page.getByRole('button', { name: 'Thêm thành viên', exact: true })).toHaveCount(0);
		await page.getByRole('button', { name: 'Sửa hồ sơ Thảo Linh', exact: true }).click();
		await expect(page.getByLabel('ID', { exact: true })).toBeDisabled();
		await page.keyboard.press('Escape');
		await page.setViewportSize({ width: 390, height: 844 });
		expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
	} finally {
		await activate(page, admin.token, false);
	}
});
