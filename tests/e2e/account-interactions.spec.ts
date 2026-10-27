import { test, expect, type Page } from '@playwright/test';
import { createDemoState } from '../../src/lib/domain/seed';
import type { AppState, LedgerEntry } from '../../src/lib/domain/types';
import { customToken } from '../../worker/src/identity';
import type { Env } from '../../worker/src/env';

const ACTOR = 'discord_100000000000000001';
const now = '2026-10-27T05:00:00.000Z';

async function openFixture(page: Page, path = '/balances', configure?: (state: AppState) => void) {
	const state = createDemoState(new Date(now));
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
					updatedAt: now
				},
				groups: [{ ...group, role: 'admin' }],
				selectedGroupId: 'local'
			}
		})
	);
	await page.route('**/api/groups/local/select', (route) => route.fulfill({ json: {} }));
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
}

for (const width of [1280, 390]) {
	test.describe(`viewport ${width}px`, () => {
		test.use({ viewport: { width, height: 844 } });

		test('account filters use net debts and include zero balances and inactive people in all', async ({
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
			await expect(page.locator('.counterpart')).toHaveCount(8);
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
			const former = page.locator('.counterpart').filter({ hasText: 'Thành viên cũ' });
			await former.locator('.qr-button-with-tooltip').hover();
			await expect(former.getByRole('tooltip')).toContainText('chưa được kích hoạt');
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
			await page.keyboard.press('Escape');
			await expect(lightbox).toHaveCount(0);
			await expect(page.getByRole('dialog', { name: 'Hóa đơn mẫu', exact: true })).toBeVisible();
			await expect(
				page.getByRole('button', { name: 'Xem ảnh hóa đơn toàn màn hình', exact: true })
			).toBeFocused();
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
