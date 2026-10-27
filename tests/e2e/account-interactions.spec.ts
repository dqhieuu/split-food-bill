import { test, expect, type Page } from '@playwright/test';
import { createDemoState } from '../../src/lib/domain/seed';
import type { AppState, LedgerEntry } from '../../src/lib/domain/types';
import { applyCommand, pairBalance } from '../../src/lib/domain/ledger';
import { customToken } from '../../worker/src/identity';
import type { Env } from '../../worker/src/env';

const ACTOR = 'discord_100000000000000001';
const now = '2026-10-27T05:00:00.000Z';

async function openFixture(page: Page, path = '/balances', configure?: (state: AppState) => void) {
	const state = createDemoState(new Date(now));
	const userPreferences = { discordBillNotifications: true };
	state.members.find((member) => member.id === 'an')!.id = ACTOR;
	state.members.find((member) => member.id === 'linh')!.bankAccount = '';
	const debt = (id: string, from: string, to: string, amount: number): LedgerEntry => ({
		id,
		from,
		to,
		amount,
		type: 'debt',
		date: now,
		description: id,
		note: '',
		creator: ACTOR,
		source: 'bill',
		reference: id
	});
	state.ledger = [
		debt('owe-linh', ACTOR, 'linh', 100000),
		debt('linh-offset', 'linh', ACTOR, 60000),
		debt('huy-owes', 'huy', ACTOR, 20000),
		debt('zero-mai', ACTOR, 'mai', 30000),
		debt('mai-offset', 'mai', ACTOR, 30000),
		debt('owe-former', ACTOR, 'former', 50000),
		debt('owe-nam', ACTOR, 'nam', 20000)
	];
	state.bills = [
		{
			id: 'receipt',
			organizer: ACTOR,
			description: 'Hóa đơn mẫu',
			date: now,
			total: 30000,
			lines: [{ memberId: ACTOR, amount: 30000, description: 'Cơm', note: '' }],
			discordNotification: false,
			image: '3f2504e0-4f89-41d3-9a0c-0305e82c3301.png',
			undoneAt: now,
			undoneBy: ACTOR
		}
	];
	state.receipts = [];
	state.settlements = [];
	configure?.(state);
	const group = {
		id: 'local',
		name: 'Nhóm mẫu',
		discordGuildId: 'guild',
		createdBy: ACTOR,
		createdAt: now,
		version: 1
	};
	await page.route('**/config', (route) =>
		route.fulfill({
			json: {
				mode: 'local',
				firebase: { apiKey: 'demo-lunchroom-key', projectId: 'demo-lunchroom', authDomain: 'localhost' },
				authEmulatorUrl: 'http://127.0.0.1:9099'
			}
		})
	);
	await page.route('**/api/session', (route) =>
		route.fulfill({
			json: {
				user: {
					id: ACTOR,
					discordId: ACTOR.slice(8),
					name: 'Minh An',
					username: 'minhan',
					role: 'admin',
					avatarUrl: '',
					email: '',
					createdAt: now,
					updatedAt: now,
					preferences: userPreferences
				},
				groups: [{ ...group, role: 'admin' }],
				selectedGroupId: 'local'
			}
		})
	);
	await page.route('**/api/groups/local/select', (route) => route.fulfill({ json: {} }));
	await page.route('**/api/preferences', (route) => {
		userPreferences.discordBillNotifications = route.request().postDataJSON().discordBillNotifications;
		return route.fulfill({ json: { preferences: userPreferences } });
	});
	await page.route('**/api/groups/local/state*', (route) =>
		route.fulfill({ json: { state, actor: ACTOR, group } })
	);
	const image = await page.evaluate(() => {
		const canvas = document.createElement('canvas');
		canvas.width = 1200;
		canvas.height = 1800;
		const drawing = canvas.getContext('2d')!;
		drawing.fillStyle = '#fffef8';
		drawing.fillRect(0, 0, 1200, 1800);
		drawing.fillStyle = '#29362c';
		drawing.font = '52px sans-serif';
		drawing.fillText('HOA DON MAU', 100, 150);
		drawing.fillText('Com trua                30.000 VND', 100, 350);
		drawing.fillText('Tong                     30.000 VND', 100, 1500);
		return canvas.toDataURL('image/png').split(',')[1];
	});
	await page.route('**/api/groups/local/images/*', (route) =>
		route.fulfill({
			contentType: 'image/png',
			body: Buffer.from(image, 'base64')
		})
	);
	// Exercise the UI against isolated fixtures without changing the local group's data.
	const token = await customToken({ APP_ENV: 'local' } as Env, ACTOR);
	await page.route('**/auth/exchange', (route) => route.fulfill({ json: { token } }));
	await page.addInitScript(() => sessionStorage.setItem('discord-login-verifier', 'a'.repeat(43)));
	await page.goto(`${path}#auth_code=${'a'.repeat(43)}`);
	await expect(page.locator('.account-button')).toContainText('Minh An');
	await expect(page.locator('.loading-panel')).toHaveCount(0);
	return { image: Buffer.from(image, 'base64'), state, userPreferences };
}

for (const width of [1280, 390]) {
	test.describe(`viewport ${width}px`, () => {
		test.use({ viewport: { width, height: 844 } });

		test('account filters use net debts and all shows only active people including zero balances', async ({
			page
		}) => {
			await openFixture(page);
			await expect(page.locator('.stat-card').nth(0)).toContainText('Bạn đang nợ');
			await expect(page.locator('.stat-card').nth(0)).toContainText('110.000 ₫');
			await expect(page.locator('.stat-card').nth(1)).toContainText('Bạn đang bị nợ');
			await expect(page.locator('.stat-card').nth(1)).toContainText('20.000 ₫');
			await expect(page.locator('.stat-card').nth(2)).toContainText('Nợ - bị nợ');
			await expect(page.locator('.stat-card').nth(2)).toContainText('90.000 ₫');
			await expect(page.getByRole('button', { name: 'Tất cả', exact: true })).toBeVisible();
			await expect(page.locator('.counterpart')).toHaveCount(7);
			await expect(page.locator('.counterpart').filter({ hasText: 'Thành viên cũ' })).toHaveCount(0);
			await page.getByRole('button', { name: 'Nợ (3)', exact: true }).click();
			await expect(page.locator('.counterpart')).toHaveCount(3);
			await expect(
				page.locator('.counterpart').filter({ hasText: 'Thảo Linh' }).locator('.counterpart-amount')
			).toContainText('40.000 ₫');
			await page.getByRole('button', { name: 'Bị nợ (1)', exact: true }).click();
			await expect(page.locator('.counterpart')).toHaveCount(1);
			await expect(page.locator('.counterpart')).toContainText('Quang Huy');
			await page.getByRole('button', { name: 'Tất cả', exact: true }).click();
			await expect(page.locator('.counterpart').filter({ hasText: 'Ngọc Mai' })).toContainText(
				'Không còn nợ'
			);
			if (width < 768) await page.getByRole('button', { name: 'Mở trình đơn', exact: true }).click();
			await page.locator('nav a[href="/matrix"]').click();
			await expect(page.getByRole('columnheader', { name: 'Nợ - bị nợ', exact: true })).toBeVisible();
			await expect(
				page
					.locator('.matrix-table tbody tr')
					.filter({ has: page.getByRole('rowheader', { name: 'Minh An', exact: true }) })
					.locator('.matrix-net')
			).toHaveText('90.000 ₫');
		});

		test('rows toggle independent histories and disabled QR explains its reason on hover and focus', async ({
			page
		}) => {
			await openFixture(page, '/balances', (state) => {
				state.ledger[0].description = 'Cơm trưa văn phòng';
				state.ledger[1].description = 'Bún bò Huế';
				state.ledger[2].description = 'Cà phê buổi chiều';
			});
			const linh = page.locator('.counterpart').filter({ hasText: 'Thảo Linh' });
			const huy = page.locator('.counterpart').filter({ hasText: 'Quang Huy' });
			await linh.getByRole('button', { name: 'Xem lịch sử với Thảo Linh', exact: true }).click();
			await huy.getByRole('button', { name: 'Lịch sử với Quang Huy', exact: true }).click();
			await expect(page.locator('.counterpart-history')).toHaveCount(2);
			await linh.screenshot({ path: `artifacts/balance-history-${width}.png` });
			await expect(linh.getByRole('button', { name: 'Lịch sử với Thảo Linh', exact: true })).toHaveAttribute(
				'aria-expanded',
				'true'
			);
			await expect(linh.getByRole('button', { name: 'Mã QR', exact: true })).toBeDisabled();
			await linh.locator('.qr-button-with-tooltip').hover();
			await expect(linh.getByRole('tooltip')).toBeVisible();
			await expect(linh.getByRole('tooltip')).toContainText('chưa cập nhật đầy đủ thông tin ngân hàng');
			await page.mouse.move(0, 0);
			await linh.locator('.qr-button-with-tooltip').focus();
			await expect(linh.getByRole('tooltip')).toBeVisible();
			await page.getByRole('button', { name: 'Nợ (3)', exact: true }).click();
			const former = page.locator('.counterpart').filter({ hasText: 'Thành viên cũ' });
			await former.locator('.qr-button-with-tooltip').hover();
			await expect(former.getByRole('tooltip')).toContainText('chưa được kích hoạt');
			await page.getByRole('button', { name: 'Tất cả', exact: true }).click();
			await page
				.locator('.counterpart')
				.filter({ hasText: 'Hoàng Nam' })
				.getByRole('button', { name: 'Mã QR', exact: true })
				.click();
			await expect(page.getByRole('dialog', { name: 'Chuyển tiền bằng QR', exact: true })).toBeVisible();
			await page.keyboard.press('Escape');
			await expect(page.locator('.counterpart-history')).toHaveCount(2);
			await linh.getByRole('button', { name: 'Lịch sử với Thảo Linh', exact: true }).click();
			await expect(linh.locator('.counterpart-history')).toHaveCount(0);
			await expect(huy.locator('.counterpart-history')).toBeVisible();
		});

		test('admin views another member’s balances and pays with the correct payer and audit creator', async ({
			page
		}) => {
			const { state } = await openFixture(page);
			let commands = 0;
			await page.route('**/api/groups/local/commands/confirmQrPayment', async (route) => {
				commands++;
				const input = route.request().postDataJSON();
				expect(input).toMatchObject({ from: 'huy', to: ACTOR, amount: 20000 });
				const result = applyCommand(state, ACTOR, 'confirmQrPayment', input, now);
				await route.fulfill({ json: { state, result } });
			});
			const historyLength = await page.evaluate(() => history.length);
			await page.getByLabel('Xem tài khoản', { exact: true }).selectOption('huy');
			await expect(page).toHaveURL(/\/balances\?member=huy$/);
			await expect(page.getByRole('heading', { name: 'Tài khoản của Quang Huy', exact: true })).toBeVisible();
			await expect(page.locator('.account-button')).toContainText('Minh An');
			expect(await page.evaluate(() => history.length)).toBe(historyLength);
			await expect(page.locator('.stat-card').first()).toContainText('Quang Huy đang nợ');
			await expect(page.locator('.stat-card').first()).toContainText('20.000 ₫');
			await expect(page.locator('.counterpart-name').filter({ hasText: 'Quang Huy' })).toHaveCount(0);
			const recipient = page.locator('.counterpart').filter({ hasText: 'Minh An' });
			await recipient.getByRole('button', { name: 'Lịch sử với Minh An', exact: true }).click();
			await expect(recipient.locator('.counterpart-history')).toContainText('Quang Huy nợ Minh An');
			await page.locator('main').screenshot({ path: 'artifacts/member-balances-admin-' + width + '.png' });
			await recipient.getByRole('button', { name: 'Mã QR', exact: true }).click();
			const dialog = page.getByRole('dialog', { name: 'Chuyển tiền bằng QR', exact: true });
			await expect(dialog).toContainText('Người trả: Quang Huy');
			await expect(dialog.getByRole('button', { name: 'Đã thanh toán', exact: true })).toBeDisabled();
			expect(commands).toBe(0);
			await dialog.getByRole('checkbox', { name: 'Quang Huy đã chuyển khoản xong', exact: true }).click();
			await expect(dialog.getByRole('button', { name: 'Đã thanh toán', exact: true })).toBeEnabled();
			await dialog.getByRole('button', { name: 'Đã thanh toán', exact: true }).click();
			await expect(dialog).toHaveCount(0);
			await expect(recipient).toContainText('Không còn nợ');
			expect(commands).toBe(1);
			expect(state.ledger.at(-1)).toMatchObject({
				from: 'huy',
				to: ACTOR,
				creator: ACTOR,
				amount: 20000,
				description: 'Quản trị viên xác nhận thanh toán bằng QR'
			});
			await page.reload();
			await expect(page.getByRole('heading', { name: 'Tài khoản của Quang Huy', exact: true })).toBeVisible();
			await page.getByLabel('Xem tài khoản', { exact: true }).selectOption(ACTOR);
			await expect(page.getByRole('heading', { name: 'Tài khoản của bạn', exact: true })).toBeVisible();
			await expect(page).toHaveURL(/\/balances$/);
		});

		test('regular members can browse another account and history while payment actions remain disabled', async ({
			page
		}) => {
			const { state } = await openFixture(page, '/balances?member=huy&to=' + ACTOR, (state) => {
				state.members.find((member) => member.id === ACTOR)!.role = 'member';
			});
			await expect(page.getByRole('heading', { name: 'Tài khoản của Quang Huy', exact: true })).toBeVisible();
			await expect(page.locator('.balances-heading')).toContainText('Chế độ chỉ xem');
			await expect(page.getByRole('dialog')).toHaveCount(0);
			const recipient = page.locator('.counterpart').filter({ hasText: 'Minh An' });
			await expect(recipient.locator('.counterpart-history')).toContainText('Quang Huy nợ Minh An');
			await expect(recipient.getByRole('button', { name: 'Mã QR', exact: true })).toBeDisabled();
			await recipient.locator('.qr-button-with-tooltip').focus();
			await expect(recipient.getByRole('tooltip')).toContainText('Chỉ quản trị viên nhóm');
			await page.getByRole('button', { name: 'Nợ (1)', exact: true }).click();
			await expect(page.locator('.counterpart')).toHaveCount(1);
			await page.locator('main').screenshot({ path: 'artifacts/member-balances-readonly-' + width + '.png' });
			await page.getByLabel('Xem tài khoản', { exact: true }).selectOption(ACTOR);
			await expect(page.getByRole('heading', { name: 'Tài khoản của bạn', exact: true })).toBeVisible();
			await expect(page.locator('.balances-heading')).not.toContainText('Chế độ chỉ xem');
			await expect(
				page
					.locator('.counterpart')
					.filter({ hasText: 'Hoàng Nam' })
					.getByRole('button', { name: 'Mã QR', exact: true })
			).toBeEnabled();
			await page.getByLabel('Xem tài khoản', { exact: true }).selectOption('huy');
			await expect(recipient.getByRole('button', { name: 'Mã QR', exact: true })).toBeDisabled();
			state.members.find((member) => member.id === ACTOR)!.role = 'admin';
			state.version++;
			await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
			await expect(recipient.getByRole('button', { name: 'Mã QR', exact: true })).toBeEnabled();
			await recipient.getByRole('button', { name: 'Mã QR', exact: true }).click();
			state.members.find((member) => member.id === ACTOR)!.role = 'member';
			state.version++;
			await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
			const dialog = page.getByRole('dialog', { name: 'Chuyển tiền bằng QR', exact: true });
			await expect(dialog.getByRole('checkbox')).toBeDisabled();
			await expect(dialog.getByRole('button', { name: 'Đã thanh toán', exact: true })).toBeDisabled();
		});

		test('internal links replace browser history and receipt images open fullscreen over bill details', async ({
			page,
			context
		}) => {
			await openFixture(page);
			const historyLength = await page.evaluate(() => history.length);
			for (const [path, name] of [
				['/', 'Tổng quan'],
				['/new-bill', 'Tạo hoá đơn'],
				['/balances', 'Tài khoản của bạn'],
				['/activity', 'Ledger']
			]) {
				if (width < 768) await page.getByRole('button', { name: 'Mở trình đơn', exact: true }).click();
				await page.locator(`nav a[href="${path}"]`).click();
				await expect(page.getByRole('heading', { name, exact: true }).first()).toBeVisible();
				expect(await page.evaluate(() => history.length)).toBe(historyLength);
			}
			await page.getByRole('switch', { name: 'Hiện hóa đơn đã hoàn tác', exact: true }).click();
			const title = page.locator('.table-title-button strong').first();
			expect(
				await title
					.locator('.undone-label')
					.evaluate((element) => parseFloat(getComputedStyle(element).marginInlineStart))
			).toBeGreaterThan(0);
			await page.getByRole('button', { name: 'Xem hóa đơn Hóa đơn mẫu', exact: true }).click();
			await page.getByRole('button', { name: 'Xem ảnh hóa đơn toàn màn hình', exact: true }).click();
			const lightbox = page.getByRole('dialog', { name: 'Ảnh hóa đơn toàn màn hình', exact: true });
			await expect(lightbox).toBeVisible();
			await expect(lightbox.locator('img')).toHaveJSProperty('naturalWidth', 1200);
			const bounds = await lightbox.boundingBox();
			expect(bounds?.x).toBe(0);
			expect(bounds?.y).toBe(0);
			expect(bounds?.width).toBe(page.viewportSize()!.width);
			expect(bounds?.height).toBe(page.viewportSize()!.height);
			expect(context.pages()).toHaveLength(1);
			const fitted = await lightbox.locator('img').boundingBox();
			await page.screenshot({ path: `artifacts/receipt-lightbox-${width}.png` });
			await lightbox.getByRole('button', { name: 'Phóng to ảnh hóa đơn', exact: true }).click();
			await expect(
				lightbox.getByRole('button', { name: 'Thu nhỏ ảnh hóa đơn', exact: true })
			).toHaveAttribute('aria-pressed', 'true');
			expect((await lightbox.locator('img').boundingBox())!.width).toBeGreaterThan(fitted!.width);
			const zoomedBounds = await lightbox.boundingBox();
			expect(zoomedBounds?.x).toBe(0);
			expect(zoomedBounds?.y).toBe(0);
			const viewport = lightbox.locator('.bill-image-viewport');
			await viewport.evaluate((element) =>
				element.scrollTo({ left: element.scrollWidth, top: element.scrollHeight })
			);
			const bottomRight = await lightbox.locator('img').boundingBox();
			const viewBounds = (await viewport.boundingBox())!;
			expect(bottomRight!.x + bottomRight!.width).toBeLessThanOrEqual(viewBounds.x + viewBounds.width + 1);
			expect(bottomRight!.y + bottomRight!.height).toBeLessThanOrEqual(viewBounds.y + viewBounds.height + 1);
			await viewport.evaluate((element) => element.scrollTo(0, 0));
			const topLeft = await lightbox.locator('img').boundingBox();
			expect(topLeft!.x).toBeGreaterThanOrEqual(viewBounds.x);
			expect(topLeft!.y).toBeGreaterThanOrEqual(viewBounds.y);
			await page.screenshot({ path: `artifacts/receipt-zoom-${width}.png` });
			await page.keyboard.press('Escape');
			await expect(lightbox).toHaveCount(0);
			await expect(page.getByRole('dialog', { name: 'Hóa đơn mẫu', exact: true })).toBeVisible();
			await expect(
				page.getByRole('button', { name: 'Xem ảnh hóa đơn toàn màn hình', exact: true })
			).toBeFocused();
		});

		test('undone bills are hidden by default and the switch only changes the Bills tab', async ({ page }) => {
			await openFixture(page, '/activity', (state) => {
				const active = { ...state.bills[0], id: 'active-bill', description: 'Hóa đơn đang có hiệu lực' };
				delete active.undoneAt;
				delete active.undoneBy;
				state.bills.push(active);
			});
			const toggle = page.getByRole('switch', { name: 'Hiện hóa đơn đã hoàn tác', exact: true });
			await expect(toggle).not.toBeChecked();
			await expect(page.locator('.clickable-bill-row')).toHaveCount(1);
			await expect(page.locator('.clickable-bill-row')).toContainText('Hóa đơn đang có hiệu lực');
			await expect(page.getByRole('button', { name: 'Hóa đơn (1)', exact: true })).toBeVisible();
			await toggle.click();
			await expect(page.locator('.clickable-bill-row')).toHaveCount(2);
			await expect(page.locator('.undone-label')).toHaveText('Đã hoàn tác');
			await page.getByLabel('Tìm giao dịch', { exact: true }).fill('Hóa đơn mẫu');
			await expect(page.locator('.clickable-bill-row')).toHaveCount(1);
			await toggle.click();
			await expect(page.locator('.clickable-bill-row')).toHaveCount(0);
			await page.getByLabel('Tìm giao dịch', { exact: true }).fill('');
			await page.getByRole('button', { name: /^Giao dịch \(/ }).click();
			await expect(toggle).toHaveCount(0);
			await expect(page.locator('.ledger-table tbody tr')).toHaveCount(7);
			await page.goto('/activity?bill=receipt');
			await expect(page.getByRole('dialog', { name: 'Hóa đơn mẫu', exact: true })).toBeVisible();
			await page.keyboard.press('Escape');
			await expect(toggle).not.toBeChecked();
			await expect(page.locator('.clickable-bill-row')).toHaveCount(1);
		});

		test('admin can choose another payer, persist the draft and retain their own creator identity', async ({
			page
		}) => {
			const { state } = await openFixture(page, '/new-bill');
			let createdId = '';
			const before = pairBalance(state.ledger, 'huy', 'linh');
			await page.route('**/api/groups/local/commands/createBill', async (route) => {
				const input = route.request().postDataJSON();
				expect(input.payerId).toBe('linh');
				createdId = input.id;
				const result = applyCommand(state, ACTOR, 'createBill', input, now);
				await route.fulfill({ json: { state, result } });
			});
			await page.getByRole('combobox', { name: 'Người thanh toán', exact: true }).selectOption('linh');
			await page.getByLabel('Tên hóa đơn', { exact: true }).fill('Hóa đơn ghi giúp Thảo Linh');
			await page.locator('.member-picker').getByRole('button', { name: 'Minh An', exact: true }).click();
			await page.locator('.member-picker').getByRole('button', { name: 'Thảo Linh', exact: true }).click();
			await page.locator('.member-picker').getByRole('button', { name: 'Quang Huy', exact: true }).click();
			await page.getByLabel('Số tiền của Thảo Linh', { exact: true }).fill('30');
			await page.getByLabel('Số tiền của Quang Huy', { exact: true }).fill('55');
			await page.reload();
			await expect(page.getByRole('combobox', { name: 'Người thanh toán', exact: true })).toHaveValue('linh');
			await page.locator('.bill-details-panel').screenshot({ path: `artifacts/bill-payer-${width}.png` });
			await page.getByRole('button', { name: 'Xem lại hóa đơn', exact: true }).click();
			const confirmation = page.getByRole('dialog', { name: 'Xác nhận hóa đơn', exact: true });
			await expect(confirmation).toContainText('Thảo Linh thanh toán');
			await confirmation.getByRole('button', { name: 'Xem trước Discord', exact: true }).click();
			const preview = page.getByRole('dialog', { name: 'Xem trước Discord', exact: true });
			await expect(preview.getByRole('link', { name: 'Mở mã QR', exact: true })).toHaveAttribute(
				'href',
				/to=linh$/
			);
			await page.keyboard.press('Escape');
			await confirmation.getByRole('button', { name: 'Xác nhận', exact: true }).click();
			await expect(page).toHaveURL(/\/activity$/);
			const row = page.locator('.clickable-bill-row').filter({ hasText: 'Hóa đơn ghi giúp Thảo Linh' });
			await expect(row).toBeVisible();
			await expect(row.locator('td').nth(1)).toContainText('Thảo Linh');
			expect(state.bills.find((bill) => bill.id === createdId)).toMatchObject({
				organizer: 'linh',
				creator: ACTOR
			});
			expect(state.ledger.filter((entry) => entry.reference === createdId)).toHaveLength(1);
			expect(state.ledger.at(-1)).toMatchObject({ from: 'huy', to: 'linh', creator: ACTOR, amount: 55000 });
			expect(pairBalance(state.ledger, 'huy', 'linh')).toBe(before + 55000);
			await row.locator('.table-title-button').click();
			await expect(page.getByRole('dialog')).toContainText('Người ghi: Minh An');
			await page.keyboard.press('Escape');
			state.members.find((member) => member.id === ACTOR)!.role = 'member';
			state.version++;
			await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
			if (width < 768) await page.getByRole('button', { name: 'Mở trình đơn', exact: true }).click();
			await page.locator('nav a[href="/new-bill"]').click();
			await expect(page.getByRole('combobox', { name: 'Người thanh toán', exact: true })).toHaveCount(0);
			await expect(page.locator('.payer-field')).toContainText('Minh An');
			await page.evaluate((actor) => {
				const key = `lunchroom-draft-local-${actor}`;
				const draft = JSON.parse(localStorage.getItem(key) || '{}');
				draft.payerId = 'linh';
				localStorage.setItem(key, JSON.stringify(draft));
			}, ACTOR);
			await page.reload();
			await expect(page.locator('.payer-field')).toContainText('Minh An');
		});

		test('Discord notification preference survives a saved bill, stale drafts and reloads, with rollback on save failure', async ({
			page
		}) => {
			const { state, userPreferences } = await openFixture(page, '/new-bill');
			let billId = '';
			await page.route('**/api/groups/local/commands/createBill', async (route) => {
				const input = route.request().postDataJSON();
				expect(input.discordNotification).toBe(false);
				billId = input.id;
				const result = applyCommand(state, ACTOR, 'createBill', input, now);
				await route.fulfill({ json: { state, result } });
			});
			const toggle = page.getByRole('switch', { name: 'Gửi thông báo qua Discord', exact: true });
			await expect(toggle).toBeChecked();
			await toggle.click();
			await expect.poll(() => userPreferences.discordBillNotifications).toBe(false);
			await expect(toggle).toBeEnabled();
			await page.getByLabel('Tên hóa đơn', { exact: true }).fill('Hóa đơn không gửi Discord');
			await page.getByLabel('Số tiền của Minh An', { exact: true }).fill('30');
			await page.getByRole('button', { name: 'Xem lại hóa đơn', exact: true }).click();
			await page
				.getByRole('dialog', { name: 'Xác nhận hóa đơn', exact: true })
				.getByRole('button', { name: 'Xác nhận', exact: true })
				.click();
			await expect(page).toHaveURL(/\/activity$/);
			expect(state.receipts.some((receipt) => receipt.billId === billId)).toBe(false);
			if (width < 768) await page.getByRole('button', { name: 'Mở trình đơn', exact: true }).click();
			await page.locator('nav a[href="/new-bill"]').click();
			await expect(toggle).not.toBeChecked();
			await page.evaluate((actor) => {
				const key = `lunchroom-draft-local-${actor}`;
				const draft = JSON.parse(localStorage.getItem(key) || '{}');
				draft.discordNotification = true;
				localStorage.setItem(key, JSON.stringify(draft));
			}, ACTOR);
			await page.reload();
			await expect(toggle).not.toBeChecked();
			await page.getByRole('button', { name: 'Gửi thông báo qua Discord', exact: true }).click();
			await expect.poll(() => userPreferences.discordBillNotifications).toBe(true);
			await expect(toggle).toBeEnabled();
			await page.reload();
			await expect(toggle).toBeChecked();
			await page.route('**/api/preferences', (route) =>
				route.fulfill({ status: 503, json: { message: 'Unavailable' } })
			);
			await toggle.click();
			await expect(page.getByRole('alert')).toContainText('Không lưu được tùy chọn Discord');
			await expect(toggle).toBeChecked();
			expect(userPreferences.discordBillNotifications).toBe(true);
		});

		for (const mode of ['manual', 'equal']) {
			test(`${mode} splits round up when selected and put the no-round remainder on the last person`, async ({
				page
			}) => {
				const { state } = await openFixture(page, '/new-bill');
				let createdId = '';
				await page.route('**/api/groups/local/commands/createBill', async (route) => {
					const input = route.request().postDataJSON();
					createdId = input.id;
					const result = applyCommand(state, ACTOR, 'createBill', input, now);
					await route.fulfill({ json: { state, result } });
				});
				await page.getByLabel('Tên hóa đơn', { exact: true }).fill(`Chia tiền ${mode}`);
				for (const name of ['Thảo Linh', 'Quang Huy'])
					await page.locator('.member-picker').getByRole('button', { name, exact: true }).click();
				const rounding = page.getByRole('combobox', { name: 'Làm tròn lên mỗi phần', exact: true });
				if (mode === 'manual') {
					await expect(rounding).toHaveCount(0);
					for (const [name, value] of [
						['Minh An', '45'],
						['Thảo Linh', '35'],
						['Quang Huy', '20']
					])
						await page.getByLabel(`Số tiền của ${name}`, { exact: true }).fill(value);
					await page.getByLabel('Giá sau khi giảm giá', { exact: true }).fill('80.001');
				} else {
					await page.getByRole('button', { name: 'Chia đều', exact: true }).click();
					await page.getByLabel('Tổng tiền cần chia', { exact: true }).fill('100.001');
				}
				const amounts = page.locator(
					mode === 'manual' ? '.discounted-share' : '.participant-line .amount-input strong'
				);
				await expect(rounding).toHaveValue('3');
				await expect(amounts).toHaveText(
					mode === 'manual'
						? ['→ 37.000 ₫', '→ 29.000 ₫', '→ 17.000 ₫']
						: ['34.000 ₫', '34.000 ₫', '34.000 ₫']
				);
				await expect(page.locator('.summary-total strong')).toHaveText(
					mode === 'manual' ? '83.000 ₫' : '102.000 ₫'
				);
				await expect(page.locator('.summary-pair').filter({ hasText: 'Làm tròn' })).toContainText(
					mode === 'manual' ? '+2.999 ₫' : '+1.999 ₫'
				);
				await rounding.selectOption('0');
				const exactAmounts =
					mode === 'manual'
						? ['→ 36.000 ₫', '→ 28.000 ₫', '→ 16.001 ₫']
						: ['33.334 ₫', '33.334 ₫', '33.333 ₫'];
				await expect(amounts).toHaveText(exactAmounts);
				await expect(page.locator('.summary-pair').filter({ hasText: 'Làm tròn' })).toHaveCount(0);
				await page.reload();
				await expect(rounding).toHaveValue('0');
				await expect(amounts).toHaveText(exactAmounts);
				if (mode === 'manual') {
					await page.getByLabel('Giá sau khi giảm giá', { exact: true }).fill('');
					await expect(rounding).toHaveCount(0);
					await expect(page.locator('.summary-total strong')).toHaveText('100.000 ₫');
					await page.getByLabel('Giá sau khi giảm giá', { exact: true }).fill('80.001');
				}
				await page
					.locator('.form-panel')
					.filter({ hasText: 'Chia hóa đơn' })
					.screenshot({ path: `artifacts/split-${mode}-${width}.png` });
				await page.getByRole('button', { name: 'Xem lại hóa đơn', exact: true }).click();
				await page
					.getByRole('dialog', { name: 'Xác nhận hóa đơn', exact: true })
					.getByRole('button', { name: 'Xác nhận', exact: true })
					.click();
				await expect(page).toHaveURL(/\/activity$/);
				const bill = state.bills.find((bill) => bill.id === createdId)!;
				expect(bill.lines.map((line) => line.amount)).toEqual(
					mode === 'manual' ? [36000, 28000, 16001] : [33334, 33334, 33333]
				);
				expect(bill.total).toBe(mode === 'manual' ? 80001 : 100001);
				expect(
					state.ledger.filter((entry) => entry.reference === createdId).map((entry) => entry.amount)
				).toEqual(mode === 'manual' ? [28000, 16001] : [33334, 33333]);
			});
		}

		test('already-paid toggle persists in drafts and logs debt plus repayment without changing balances', async ({
			page
		}) => {
			const { state } = await openFixture(page, '/new-bill');
			const originalLedger = structuredClone(state.ledger);
			const balancesBefore = state.members.map((member) => pairBalance(state.ledger, ACTOR, member.id));
			let createdId = '';
			await page.route('**/api/groups/local/commands/createBill', async (route) => {
				const input = route.request().postDataJSON();
				expect(input.alreadyPaid).toBe(true);
				createdId = input.id;
				const result = applyCommand(state, ACTOR, 'createBill', input, now);
				await route.fulfill({ json: { state, result } });
			});
			await page.route('**/api/groups/local/commands/undoBill', async (route) => {
				const result = applyCommand(state, ACTOR, 'undoBill', route.request().postDataJSON(), now);
				await route.fulfill({ json: { state, result } });
			});
			const toggle = page.getByRole('switch', { name: 'Mọi người đã thanh toán', exact: true });
			await expect(toggle).not.toBeChecked();
			await page.getByLabel('Tên hóa đơn', { exact: true }).fill('Cơm trưa đã thanh toán');
			await page.locator('.member-picker').getByRole('button', { name: 'Thảo Linh', exact: true }).click();
			await page.getByLabel('Số tiền của Minh An', { exact: true }).fill('30');
			await page.getByLabel('Số tiền của Thảo Linh', { exact: true }).fill('55');
			await toggle.click();
			await page.reload();
			await expect(toggle).toBeChecked();
			await expect(page.getByLabel('Số tiền của Thảo Linh', { exact: true })).toHaveValue('55');
			await page.locator('.bill-summary').screenshot({ path: `artifacts/already-paid-summary-${width}.png` });
			await page.getByRole('button', { name: 'Xem lại hóa đơn', exact: true }).click();
			const confirmation = page.getByRole('dialog', { name: 'Xác nhận hóa đơn', exact: true });
			await expect(confirmation.getByRole('status')).toContainText('Không phát sinh nợ mới');
			await confirmation.getByRole('button', { name: 'Xem trước Discord', exact: true }).click();
			const preview = page.getByRole('dialog', { name: 'Xem trước Discord', exact: true });
			await expect(preview).toContainText('Đã thanh toán: 55.000 ₫');
			await expect(preview).not.toContainText('Bạn phải trả');
			await expect(preview).not.toContainText('Mở mã QR');
			await page.keyboard.press('Escape');
			await confirmation.getByRole('button', { name: 'Xác nhận', exact: true }).click();
			await expect(page).toHaveURL(/\/activity$/);
			const billRow = page.locator('.clickable-bill-row').filter({ hasText: 'Cơm trưa đã thanh toán' });
			await expect(billRow.locator('.paid-bill-label')).toHaveText('Đã thanh toán');
			expect(state.ledger.slice(0, originalLedger.length)).toEqual(originalLedger);
			expect(state.members.map((member) => pairBalance(state.ledger, ACTOR, member.id))).toEqual(
				balancesBefore
			);
			const entries = state.ledger.filter((entry) => entry.reference === createdId);
			expect(entries.map((entry) => entry.type)).toEqual(['debt', 'payment']);
			expect(
				entries.every((entry) => entry.from === 'linh' && entry.to === ACTOR && entry.amount === 55000)
			).toBe(true);
			await page.getByRole('button', { name: /^Giao dịch \(/ }).click();
			const ledgerRows = page.locator('.ledger-table tbody tr').filter({ hasText: 'Cơm trưa đã thanh toán' });
			await expect(ledgerRows).toHaveCount(2);
			await expect(ledgerRows.locator('.status-pill.danger')).toHaveText('Nợ');
			await expect(ledgerRows.locator('.status-pill.success')).toHaveText('Trả');
			await page.getByRole('button', { name: /^Hóa đơn \(/ }).click();
			await billRow.locator('.table-title-button').click();
			const detail = page.getByRole('dialog', { name: 'Cơm trưa đã thanh toán', exact: true });
			await expect(detail.getByRole('status')).toContainText('Mọi người đã thanh toán đầy đủ');
			await detail.getByRole('button', { name: 'Hoàn tác hóa đơn', exact: true }).click();
			await expect(detail.getByRole('alert')).toContainText('cả khoản nợ và khoản trả');
			await detail.getByRole('button', { name: 'Xác nhận hoàn tác', exact: true }).click();
			await expect(detail.getByRole('status')).toContainText('Đã hoàn tác');
			expect(state.members.map((member) => pairBalance(state.ledger, ACTOR, member.id))).toEqual(
				balancesBefore
			);
		});

		test('bill confirmation previews the receipt and opens a correctly positioned fullscreen viewer', async ({
			page
		}) => {
			const { image } = await openFixture(page, '/new-bill');
			await page.route('**/api/groups/local/images', (route) =>
				route.fulfill({ json: { imageId: '3f2504e0-4f89-41d3-9a0c-0305e82c3301.png' } })
			);
			await page.getByLabel('Tên hóa đơn', { exact: true }).fill('Cơm trưa có ảnh');
			await page.getByLabel('Số tiền của Minh An', { exact: true }).fill('55');
			await page
				.getByLabel('Chọn ảnh hóa đơn', { exact: true })
				.setInputFiles({ name: 'receipt.png', mimeType: 'image/png', buffer: image });
			await expect(page.locator('.bill-image-attached img')).toHaveJSProperty('naturalWidth', 1200);
			await page.getByRole('button', { name: 'Xem lại hóa đơn', exact: true }).click();
			const confirmation = page.getByRole('dialog', { name: 'Xác nhận hóa đơn', exact: true });
			await expect(confirmation.locator('.bill-detail-image img')).toHaveJSProperty('naturalWidth', 1200);
			await expect(confirmation).not.toContainText('Kèm ảnh hóa đơn.');
			await confirmation.getByRole('button', { name: 'Xem ảnh hóa đơn toàn màn hình', exact: true }).click();
			const lightbox = page.getByRole('dialog', { name: 'Ảnh hóa đơn toàn màn hình', exact: true });
			await expect(lightbox).toBeVisible();
			expect(await lightbox.boundingBox()).toEqual({ x: 0, y: 0, width, height: 844 });
			await lightbox.getByRole('button', { name: 'Phóng to ảnh hóa đơn', exact: true }).click();
			expect(await lightbox.boundingBox()).toEqual({ x: 0, y: 0, width, height: 844 });
			await page.keyboard.press('Escape');
			await expect(confirmation).toBeVisible();
			await expect(confirmation.getByRole('button', { name: 'Xác nhận', exact: true })).toBeEnabled();
			await confirmation.screenshot({ path: `artifacts/confirmation-receipt-${width}.png` });
		});

		test('compact payment history opens only bills and long bill details have one scroll area', async ({
			page
		}) => {
			await openFixture(page, '/', (state) => {
				const bill = state.bills[0];
				delete bill.undoneAt;
				delete bill.undoneBy;
				bill.lines = Array.from({ length: 18 }, (_, index) => ({
					memberId: index === 0 ? ACTOR : 'linh',
					amount: 30000,
					description: `Món ăn ${index + 1}`,
					note: ''
				}));
				bill.total = 540000;
				state.ledger = Array.from({ length: 12 }, (_, index) => ({
					id: `payment-${String(index).padStart(2, '0')}`,
					from: 'linh',
					to: ACTOR,
					type: 'payment',
					amount: 30000,
					date: now,
					createdAt: now,
					description: `Chuyển khoản ${index + 1}`,
					note: '',
					creator: ACTOR,
					source: 'qr',
					reference: `payment-${index}`
				}));
				state.ledger.push({
					...state.ledger[0],
					id: 'z-bill',
					type: 'debt',
					source: 'bill',
					description: bill.description,
					reference: bill.id
				});
			});
			const rows = page.locator('.payment-history-row');
			await expect(rows).toHaveCount(10);
			const separator = await rows.first().evaluate((element) => {
				const style = getComputedStyle(element);
				return {
					width: style.borderBottomWidth,
					color: style.borderBottomColor,
					padding: parseFloat(style.paddingTop)
				};
			});
			expect(separator.width).toBe('1px');
			expect(separator.color).not.toBe('rgba(0, 0, 0, 0)');
			expect(separator.padding).toBeLessThan(13);
			await page.locator('div.payment-history-row').first().click();
			await expect(page.getByRole('dialog')).toHaveCount(0);
			await page
				.locator('.payment-history-panel')
				.screenshot({ path: `artifacts/compact-payments-${width}.png` });
			await page.setViewportSize({ width, height: 600 });
			await page.locator('button.payment-history-row').click();
			const dialog = page.getByRole('dialog', { name: 'Hóa đơn mẫu', exact: true });
			await expect(dialog).toBeVisible();
			await expect(dialog.locator('.bill-detail-lines')).toContainText('Minh An (Trả tiền hoá đơn)');
			await expect(dialog.locator('.bill-detail-image img')).toHaveJSProperty('naturalWidth', 1200);
			expect(
				await dialog.locator('.bill-detail-image img').evaluate((image) => image.clientHeight)
			).toBeLessThanOrEqual(180);
			const scrollAreas = await dialog.evaluate(
				(element) =>
					[element, ...element.querySelectorAll('*')].filter(
						(child) =>
							['auto', 'scroll'].includes(getComputedStyle(child).overflowY) &&
							child.scrollHeight > child.clientHeight + 1
					).length
			);
			expect(scrollAreas).toBe(1);
			await page.screenshot({ path: `artifacts/bill-detail-scroll-${width}.png` });
			await dialog.evaluate((element) => {
				element.scrollTop = element.scrollHeight;
			});
			await expect(dialog.locator('.summary-total')).toBeInViewport();
			await expect(dialog.getByRole('button', { name: 'Hoàn tác hóa đơn', exact: true })).toBeInViewport();
		});

		test('calendar browses future months and payment history links to the Transactions tab', async ({
			page
		}) => {
			await openFixture(page, '/', (state) => {
				delete state.bills[0].undoneAt;
				delete state.bills[0].undoneBy;
				state.ledger[0].reference = state.bills[0].id;
			});
			await page.locator('button.payment-history-row').hover();
			await page
				.locator('.payment-history-panel')
				.screenshot({ path: `artifacts/payment-hover-${width}.png` });
			const monthLabel = page.locator('.cal-month strong');
			const initial = (await monthLabel.innerText()).match(/(\d+)\/(\d{4})/)!;
			const future = new Date(Date.UTC(Number(initial[2]), Number(initial[1]) + 2, 1));
			for (let month = 0; month < 3; month++)
				await page.getByRole('button', { name: 'Tháng sau', exact: true }).click();
			await expect(monthLabel).toHaveText(`Tháng ${future.getUTCMonth() + 1}/${future.getUTCFullYear()}`);
			await expect(
				page.getByRole('grid', {
					name: `Chi tiêu tháng ${future.getUTCMonth() + 1}/${future.getUTCFullYear()}`,
					exact: true
				})
			).toBeVisible();
			for (let month = 0; month < 3; month++)
				await page.getByRole('button', { name: 'Tháng trước', exact: true }).click();
			await expect(monthLabel).toHaveText(`Tháng ${Number(initial[1])}/${initial[2]}`);
			await page.locator('.spending-panel').screenshot({ path: `artifacts/spending-header-${width}.png` });
			await page.getByRole('link', { name: 'Xem lịch sử', exact: true }).click();
			await expect(page).toHaveURL(/\/activity\?tab=ledger$/);
			await expect(page.locator('.ledger-table')).toBeVisible();
			await expect(page.locator('.filter-toolbar button.active')).toContainText('Giao dịch');
			await page.reload();
			await expect(page.locator('.ledger-table')).toBeVisible();
			await page.getByRole('button', { name: /^Hóa đơn \(/ }).click();
			await expect(page.locator('.clickable-bill-row')).toBeVisible();
			if (width < 768) await page.getByRole('button', { name: 'Mở trình đơn', exact: true }).click();
			await page.locator('nav a[href="/new-bill"]').click();
			await expect(page.locator('.bill-summary-heading')).toBeVisible();
			await page.locator('.bill-summary').screenshot({ path: `artifacts/bill-summary-heading-${width}.png` });
			await page.route('**/api/discord/guilds', (route) => route.fulfill({ json: { guilds: [] } }));
			if (width < 768) await page.getByRole('button', { name: 'Mở trình đơn', exact: true }).click();
			await page.locator('nav a[href="/groups"]').click();
			await expect(page.getByRole('heading', { name: 'Nhóm của bạn', exact: true })).toBeVisible();
			await page.locator('.groups-layout').screenshot({ path: `artifacts/group-headers-${width}.png` });
		});
	});
}
