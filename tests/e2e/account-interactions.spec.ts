import { test, expect, type Page } from '@playwright/test';
import { createDemoState } from '../../src/lib/domain/seed';
import type { AppState, LedgerEntry } from '../../src/lib/domain/types';
import { applyCommand, localDate, pairBalance } from '../../src/lib/domain/ledger';
import { customToken } from '../../worker/src/identity';
import type { Env } from '../../worker/src/env';

const ACTOR = 'discord_100000000000000001';
const now = '2026-10-27T05:00:00.000Z';

async function openFixture(
	page: Page,
	path = '/balances',
	configure?: (state: AppState) => void,
	options: { aiEnabled?: boolean } = {}
) {
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
		version: 1,
		...(options.aiEnabled ? { aiEnabled: true } : {})
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

		test('AI effort can be changed by itself, reopened, and reset to model default', async ({ page }) => {
			let settings = {
				endpoint: 'https://ai.example/v1',
				model: 'example-model',
				hasApiKey: true,
				reasoningEffort: ''
			};
			await page.route('**/api/discord/guilds*', (route) =>
				route.fulfill({ json: { guilds: [{ id: 'guild', name: 'Máy chủ mẫu' }] } })
			);
			await page.route('**/api/groups/local/ai-settings', (route) => route.fulfill({ json: settings }));
			const saved: unknown[] = [];
			await page.route('**/api/groups/local/commands/saveAiSettings', (route) => {
				const input = route.request().postDataJSON();
				saved.push(input);
				settings = { ...settings, reasoningEffort: input.reasoningEffort };
				return route.fulfill({ json: {} });
			});
			await openFixture(page, '/groups');
			const dialog = page.getByRole('dialog', { name: 'Cấu hình nhóm', exact: true });
			for (const value of ['high', '']) {
				await page.locator('.group-choice').filter({ hasText: 'Nhóm mẫu' }).click();
				const effort = dialog.getByRole('combobox', { name: /^Reasoning effort/ });
				await expect(effort).toHaveValue(settings.reasoningEffort);
				await effort.selectOption(value);
				await dialog.getByRole('button', { name: 'Lưu cấu hình', exact: true }).click();
				await expect(dialog).toHaveCount(0);
				expect(saved.at(-1)).toEqual({
					endpoint: settings.endpoint,
					model: settings.model,
					reasoningEffort: value,
					apiKey: ''
				});
			}
			await page.locator('.group-choice').filter({ hasText: 'Nhóm mẫu' }).click();
			await expect(dialog.getByRole('combobox', { name: /^Reasoning effort/ })).toHaveValue('');
		});

		test('home opens your account and the picker keeps focus through repeated changes', async ({ page }) => {
			await openFixture(page, '/');
			await expect(page.getByRole('heading', { name: 'Tài khoản của bạn', exact: true })).toBeVisible();
			const picker = page.getByRole('combobox', { name: 'Xem tài khoản', exact: true });
			const historyLength = await page.evaluate(() => history.length);
			for (const [id, heading] of [
				['huy', 'Tài khoản của Quang Huy'],
				['linh', 'Tài khoản của Thảo Linh'],
				['mai', 'Tài khoản của Ngọc Mai'],
				[ACTOR, 'Tài khoản của bạn']
			]) {
				await picker.focus();
				await picker.selectOption(id);
				await expect(page.getByRole('heading', { name: heading, exact: true })).toBeVisible();
				await expect(picker).toBeFocused();
				await expect(picker).toHaveValue(id);
				expect(await page.evaluate(() => history.length)).toBe(historyLength);
			}
			await expect(page).toHaveURL(/\/$/);
		});

		test('account dropdown edits this group profile in a popup and supports logout', async ({ page }) => {
			const { state } = await openFixture(page, '/balances', (state) => {
				Object.assign(
					state.members.find((member) => member.id === ACTOR)!,
					{ role: 'member', name: 'Minh An trong nhóm' }
				);
			});
			let saves = 0;
			await page.route('**/api/groups/local/commands/saveMember', async (route) => {
				saves++;
				if (saves === 1)
					return route.fulfill({ status: 503, json: { message: 'Chưa lưu được hồ sơ. Thử lại.' } });
				const input = route.request().postDataJSON();
				expect(input).toMatchObject({
					id: ACTOR,
					role: 'member',
					active: true,
					name: 'Minh An của nhóm',
					bankCode: '970436',
					bankAccount: '123456789'
				});
				const result = applyCommand(state, ACTOR, 'saveMember', input, now);
				await route.fulfill({ json: { state, result } });
			});
			const trigger = page.getByRole('button', { name: 'Tài khoản', exact: true });
			const menu = page.getByRole('menu');
			await trigger.click();
			await expect(menu.getByRole('menuitem')).toHaveCount(2);
			await expect(menu.getByRole('menuitem', { name: 'Thông tin tài khoản', exact: true })).toBeVisible();
			await expect(menu.getByRole('menuitem', { name: 'Đăng xuất', exact: true })).toBeVisible();
			await expect(page.getByRole('dialog')).toHaveCount(0);
			const bounds = (await menu.boundingBox())!;
			expect(bounds.x).toBeGreaterThanOrEqual(0);
			expect(bounds.x + bounds.width).toBeLessThanOrEqual(page.viewportSize()!.width);
			await page.keyboard.press('Escape');
			await expect(menu).toHaveCount(0);
			await expect(trigger).toBeFocused();
			await trigger.click();
			const heading = (await page
				.getByRole('heading', { name: 'Tài khoản của bạn', exact: true })
				.boundingBox())!;
			await page.mouse.click(heading.x + 2, heading.y + heading.height / 2);
			await expect(menu).toHaveCount(0);
			await trigger.focus();
			await page.keyboard.press('ArrowDown');
			await expect(menu.getByRole('menuitem', { name: 'Thông tin tài khoản', exact: true })).toBeFocused();
			await page.keyboard.press('Enter');
			await expect(page).toHaveURL(/\/balances$/);
			await expect(menu).toHaveCount(0);
			const profile = page.getByRole('dialog', { name: 'Thông tin tài khoản', exact: true });
			await expect(profile).toBeVisible();
			await expect(profile).toContainText('Nhóm mẫu');
			await expect(profile.getByLabel('Tên', { exact: true })).toHaveValue('Minh An trong nhóm');
			await expect(profile.getByLabel('ID', { exact: true })).toBeDisabled();
			await expect(profile.getByLabel('Vai trò', { exact: true })).toBeDisabled();
			await expect(
				profile.getByRole('switch', { name: 'Thành viên đang hoạt động', exact: true })
			).toBeDisabled();
			await profile.getByLabel('Tên', { exact: true }).fill('Minh An của nhóm');
			await profile.getByLabel('Ngân hàng', { exact: true }).fill('Vietcombank');
			await profile.getByLabel('Số tài khoản', { exact: true }).fill('123456789');
			const refreshed = page.waitForResponse((response) =>
				response.url().includes('/api/groups/local/state')
			);
			state.version++;
			await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
			await refreshed;
			await expect(profile.getByLabel('Tên', { exact: true })).toHaveValue('Minh An của nhóm');
			await profile.getByRole('button', { name: 'Lưu hồ sơ', exact: true }).click();
			await expect(page.locator('.error-toast')).toContainText('Thử lại');
			await expect(profile.getByLabel('Tên', { exact: true })).toHaveValue('Minh An của nhóm');
			await profile.getByRole('button', { name: 'Lưu hồ sơ', exact: true }).click();
			await expect(profile).toHaveCount(0);
			await expect(page).toHaveURL(/\/balances$/);
			await trigger.click();
			await menu.getByRole('menuitem', { name: 'Thông tin tài khoản', exact: true }).click();
			await expect(profile.getByLabel('Tên', { exact: true })).toHaveValue('Minh An của nhóm');
			await page.keyboard.press('Escape');
			await trigger.click();
			await menu.getByRole('menuitem', { name: 'Đăng xuất', exact: true }).click();
			await expect(page.getByRole('button', { name: 'Đăng nhập bằng Discord', exact: true })).toBeVisible();
			await expect(trigger).toHaveCount(0);
		});

		for (const missingField of ['bankCode', 'bankAccount', 'both'] as const) {
			test(`missing ${missingField} shows an actionable warning on your own account`, async ({ page }) => {
				const { state } = await openFixture(page, '/balances', (state) => {
					const member = state.members.find((member) => member.id === ACTOR)!;
					if (missingField === 'both') {
						member.bankCode = '';
						member.bankAccount = '';
					} else member[missingField] = '   ';
				});
				await page.route('**/api/groups/local/commands/saveMember', async (route) => {
					const input = route.request().postDataJSON();
					const result = applyCommand(state, ACTOR, 'saveMember', input, now);
					await route.fulfill({ json: { state, result } });
				});
				const warning = page.getByRole('status').filter({ hasText: 'Bạn chưa điền thông tin ngân hàng' });
				await expect(warning).toBeVisible();
				if (missingField === 'bankCode')
					await page.screenshot({ path: `artifacts/bank-account-warning-${width}.png` });
				const warningBounds = (await warning.boundingBox())!;
				const statsBounds = (await page.locator('.balance-stat-grid').boundingBox())!;
				expect(warningBounds.y + warningBounds.height).toBeLessThanOrEqual(statsBounds.y);
				expect(warningBounds.x + warningBounds.width).toBeLessThanOrEqual(width);
				const picker = page.getByRole('combobox', { name: 'Xem tài khoản', exact: true });
				await picker.selectOption('linh');
				await expect(warning).toHaveCount(0);
				await picker.selectOption(ACTOR);
				await warning.getByRole('button', { name: 'Cập nhật ngay', exact: true }).click();
				const profile = page.getByRole('dialog', { name: 'Thông tin tài khoản', exact: true });
				await expect(profile).toBeVisible();
				const missingInput = profile.getByLabel(
					missingField === 'bankAccount' ? 'Số tài khoản' : 'Ngân hàng',
					{ exact: true }
				);
				await expect(missingInput).toBeFocused();
				await page.keyboard.press('Escape');
				await warning.getByRole('button', { name: 'Cập nhật ngay', exact: true }).click();
				await expect(missingInput).toBeFocused();
				await profile.getByLabel('Ngân hàng', { exact: true }).fill('Vietcombank');
				await profile.getByLabel('Số tài khoản', { exact: true }).fill('123456789');
				await profile.getByRole('button', { name: 'Lưu hồ sơ', exact: true }).click();
				await expect(profile).toHaveCount(0);
				await expect(warning).toHaveCount(0);
				await expect(page).toHaveURL(/\/balances$/);
			});
		}

		test('change history excludes obsolete release-view events before limiting rows', async ({ page }) => {
			const { state } = await openFixture(page, '/members', (state) => {
				state.audit = [
					...Array.from({ length: 120 }, (_, index) => ({
						id: `obsolete-${index}`,
						actor: ACTOR,
						action: 'markReleaseSeen',
						reference: 'old-version',
						date: now
					})),
					{
						id: 'member-edit',
						actor: ACTOR,
						action: 'saveMember',
						reference: ACTOR,
						date: '2026-10-26T05:00:00.000Z'
					}
				];
			});
			await page.getByRole('button', { name: 'Lịch sử thay đổi', exact: true }).click();
			await expect(page.locator('.audit-table tbody tr')).toHaveCount(1);
			await expect(page.locator('.audit-table')).toContainText('Cập nhật thành viên');
			state.audit = state.audit.filter((event) => event.action === 'markReleaseSeen');
			state.version++;
			await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
			await expect(page.locator('.audit-table tbody tr')).toHaveCount(0);
			await expect(
				page.getByText('Các thay đổi tiếp theo sẽ được ghi lại tại đây.', { exact: true })
			).toBeVisible();
		});

		test('member management retains its shared profile editor and admin permissions', async ({ page }) => {
			const { state } = await openFixture(page, '/members');
			await page.route('**/api/groups/local/commands/saveMember', async (route) => {
				const input = route.request().postDataJSON();
				expect(input).toMatchObject({ id: 'linh', name: 'Thảo Linh cập nhật', role: 'member' });
				const result = applyCommand(state, ACTOR, 'saveMember', input, now);
				await route.fulfill({ json: { state, result } });
			});
			await page.getByRole('button', { name: 'Sửa hồ sơ Thảo Linh', exact: true }).click();
			const profile = page.getByRole('dialog', { name: 'Chỉnh sửa hồ sơ', exact: true });
			await expect(profile.getByLabel('Tên', { exact: true })).toHaveValue('Thảo Linh');
			await expect(profile.getByLabel('Vai trò', { exact: true })).toBeEnabled();
			await profile.getByLabel('Tên', { exact: true }).fill('Thảo Linh cập nhật');
			await profile.getByRole('button', { name: 'Lưu hồ sơ', exact: true }).click();
			await expect(profile).toHaveCount(0);
			await expect(
				page.getByRole('button', { name: 'Sửa hồ sơ Thảo Linh cập nhật', exact: true })
			).toBeVisible();
		});

		test('royal leaderboard follows the matrix in navigation and opens real member balances', async ({
			page
		}) => {
			if (width < 760) await page.setViewportSize({ width: 375, height: 812 });
			await openFixture(page, '/matrix');
			if (width < 760) await page.getByRole('button', { name: 'Mở trình đơn', exact: true }).click();
			await expect(page.locator('aside nav a[href="/matrix"] + a')).toHaveAttribute('href', '/leaderboard');
			await page.locator('aside nav a[href="/leaderboard"]').click();
			await expect(page.getByRole('heading', { name: 'Bảng xếp hạng', exact: true })).toBeVisible();
			await expect(page.locator('.throne-occupant')).toContainText('Thảo Linh');
			await expect(page.locator('.debt-ropes .rope-strand')).toHaveCount(2);
			await expect(page.locator('.figure-model[data-renderer="3d"]')).toHaveCount(5);
			await expect(page.locator('.courtier .figure-model[data-pose="kneeling"]')).toHaveCount(1);
			await expect(page.locator('.courtier .commoner')).toHaveCount(0);
			await expect(page.locator('.court-gathering .commoner')).toHaveCount(1);
			const ropes = page.locator('.rope-model');
			await expect(ropes).toHaveAttribute('data-renderer', '3d');
			await expect(ropes).toHaveAttribute('data-ropes', '2');
			expect(await ropes.evaluate((el) => Number(getComputedStyle(el).opacity))).toBe(1);
			const moneyBottom = await page
				.locator('.courtier .figure-amount')
				.evaluateAll((elements) => Math.max(...elements.map((el) => el.getBoundingClientRect().bottom)));
			const debtorTop = (await page.locator('.court-gathering').boundingBox())!.y;
			expect(debtorTop).toBeGreaterThan(moneyBottom);

			// Ropes finish at the illustrated wrists, including after responsive resizing.
			const ropeError = () =>
				page.locator('.palace-world').evaluate((world) => {
					const wrists = [...world.querySelectorAll('.servant .rope-anchor')];
					return Math.max(
						...[...world.querySelectorAll<SVGPathElement>('.rope-strand')].map((path, index) => {
							const end = path.getPointAtLength(path.getTotalLength());
							const point = new DOMPoint(end.x, end.y).matrixTransform(path.getScreenCTM()!);
							const wrist = wrists[index].getBoundingClientRect();
							return Math.hypot(point.x - wrist.left, point.y - wrist.top);
						})
					);
				});
			await expect.poll(ropeError).toBeLessThan(2);
			const originalSize = page.viewportSize()!;
			await page.setViewportSize({ ...originalSize, width: originalSize.width - 20 });
			await expect.poll(ropeError).toBeLessThan(2);
			await page.setViewportSize(originalSize);
			await expect(page.locator('.rank-row').first()).toContainText('Thảo Linh');
			await expect(page.locator('.rank-row').first().locator('.rank-balance strong')).toHaveText('40.000 ₫');
			await expect(page.locator('.rank-row[data-self="true"] .rank-balance strong')).toHaveText('-90.000 ₫');
			await expect(page.locator('.rank-row')).toHaveCount(8);
			await expect(page.locator('.rank-row', { hasText: 'Thành viên cũ' })).toHaveCount(0);
			expect(await page.locator('.royal-hero').evaluate((element) => element.scrollLeft)).toBe(0);
			expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(width < 760 ? 375 : width);
			await page.evaluate(() => window.scrollTo(0, 0));
			await page.screenshot({ path: `artifacts/royal-court-viewport-${width}.png` });
			await page.screenshot({ path: `artifacts/royal-court-${width}.png`, fullPage: true });
			await page.locator('.court-filters').getByRole('button', { name: 'Nô bộc' }).click();
			await expect(page.locator('.rank-row')).toHaveCount(2);
			await page.getByRole('button', { name: 'Tìm tôi', exact: true }).click();
			await expect(page.locator('.rank-row')).toHaveCount(8);
			await expect(page.locator('.rank-row[data-self="true"]')).toBeFocused();
			await page.locator('.rank-row[data-self="true"]').click();
			const dialog = page.getByRole('dialog');
			await expect(dialog).toContainText('Nô bộc');
			await expect(dialog.locator('.profile-net')).toContainText('90.000');
			await dialog.getByRole('link', { name: 'Xem tài khoản' }).click();
			await expect(page).toHaveURL(new RegExp(`/balances\\?member=${ACTOR}$`));
			await expect(page.getByRole('heading', { name: 'Tài khoản của bạn', exact: true })).toBeVisible();
		});

		test('royal court updates its crown with live balances and handles a vacant throne', async ({ page }) => {
			const { state } = await openFixture(page, '/leaderboard');
			await expect(page.locator('.throne-occupant')).toContainText('Thảo Linh');
			state.ledger.push({ ...state.ledger[0], id: 'crown-change', from: 'linh', to: ACTOR, amount: 150000 });
			await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
			await expect(page.locator('.throne-occupant')).toContainText('Minh An');
			state.ledger = [];
			await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
			await expect(page.locator('.vacant-throne')).toContainText('Ngai vàng đang chờ');
			await expect(page.locator('.debt-ropes .rope-strand')).toHaveCount(0);
			await expect(page.locator('.rank-row.sovereign')).toHaveCount(0);
			await expect(page.locator('.rank-row.commoner')).toHaveCount(8);
			await expect(page.locator('.courtier')).toHaveCount(0);
			await expect(page.locator('.rank-balance strong').first()).toHaveText('0 ₫');
			await page.locator('.court-filters').getByRole('button', { name: 'Hoàng tộc' }).click();
			await expect(page.locator('.court-empty')).toContainText('Chưa có ai mang tước vị này.');
		});

		test('royal court renders detailed avatar faces and always animates visible figures', async ({
			page
		}) => {
			const errors: string[] = [];
			page.on('pageerror', (error) => errors.push(error.message));
			await page.route('https://avatars.example.test/portrait.svg', (route) =>
				route.fulfill({
					contentType: 'image/svg+xml',
					headers: { 'Access-Control-Allow-Origin': '*' },
					body: '<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256"><rect width="256" height="256" fill="#408b9c"/><path d="M32 256Q38 170 128 170Q218 170 224 256" fill="#30487c"/><ellipse cx="128" cy="108" rx="65" ry="82" fill="#e5ae87"/><path d="M61 106Q40 16 127 14Q219 20 194 104L170 60L110 75L77 63Z" fill="#29272e"/><path d="M91 104h19m36 0h19" stroke="#30262b" stroke-width="10" stroke-linecap="round"/><path d="M104 146q24 20 48 0" fill="none" stroke="#97494a" stroke-width="8"/></svg>'
				})
			);
			await page.route('https://avatars.example.test/missing.png', (route) =>
				route.fulfill({ status: 404, body: '' })
			);
			await openFixture(page, '/leaderboard', (state) => {
				state.members.find((member) => member.id === 'linh')!.avatarUrl =
					'https://avatars.example.test/portrait.svg';
				state.members.find((member) => member.id === 'huy')!.avatarUrl =
					'https://avatars.example.test/missing.png';
			});
			const figure = page.locator('.throne-occupant .figure-model');
			await expect(figure).toHaveAttribute('data-renderer', '3d');
			await expect(figure).toHaveAttribute('data-avatar', 'photo');
			await expect(figure).toHaveAttribute('data-rig', 'skinned');
			expect(await figure.getAttribute('data-triangles').then(Number)).toBeGreaterThan(60000);
			await expect(page.locator('.court-figure.servant .figure-model').first()).toHaveAttribute(
				'data-avatar',
				'initials'
			);
			const pixels = () => figure.evaluate((canvas: HTMLCanvasElement) => canvas.toDataURL());
			const still = await pixels();
			await page.emulateMedia({ reducedMotion: 'no-preference' });
			await expect(figure).toHaveAttribute('data-motion', 'idle');
			await expect.poll(pixels).not.toBe(still);
			const before = await figure.evaluate((canvas: HTMLCanvasElement) =>
				Array.from(canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height).data)
			);
			await figure.screenshot({ path: `artifacts/court-idle-before-${width}.png` });
			// Require a visible change across the model, not just a different PNG encoding.
			await expect
				.poll(() =>
					figure.evaluate((canvas: HTMLCanvasElement, previous) => {
						const current = canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height).data;
						let changed = 0;
						for (let i = 0; i < current.length; i += 4) {
							if (
								Math.abs(current[i] - previous[i]) +
									Math.abs(current[i + 1] - previous[i + 1]) +
									Math.abs(current[i + 2] - previous[i + 2]) >
								45
							)
								changed++;
						}
						return changed;
					}, before)
				)
				.toBeGreaterThan(400);
			await figure.screenshot({ path: `artifacts/court-idle-after-${width}.png` });
			// Cropping below the face catches regressions where only the head animates.
			for (const body of [figure, page.locator('.court-figure.servant .figure-model').first()]) {
				await body.scrollIntoViewIfNeeded();
				await expect(body).toHaveAttribute('data-motion', 'idle');
				const torso = () =>
					body.evaluate((canvas: HTMLCanvasElement) => {
						const y = Math.round(canvas.height * 0.4);
						return Array.from(
							canvas.getContext('2d')!.getImageData(0, y, canvas.width, Math.round(canvas.height * 0.35)).data
						);
					});
				const original = await torso();
				await expect
					.poll(async () => {
						const current = await torso();
						let changed = 0;
						for (let i = 0; i < current.length; i += 4)
							if (
								Math.abs(current[i] - original[i]) +
									Math.abs(current[i + 1] - original[i + 1]) +
									Math.abs(current[i + 2] - original[i + 2]) >
								45
							)
								changed++;
						return changed;
					})
					.toBeGreaterThan(100);
			}
			await page.locator('.court-register').scrollIntoViewIfNeeded();
			await expect(figure).toHaveAttribute('data-motion', 'still');
			await figure.scrollIntoViewIfNeeded();
			await expect(figure).toHaveAttribute('data-motion', 'idle');
			await page.emulateMedia({ reducedMotion: 'reduce' });
			await expect(figure).toHaveAttribute('data-motion', 'idle');
			const reducedFrame = await pixels();
			await expect.poll(pixels).not.toBe(reducedFrame);
			await expect(page.getByRole('button', { name: /Bật chuyển động|Tạm dừng chuyển động/ })).toHaveCount(0);
			await page.locator('.palace-stage').screenshot({ path: `artifacts/court-3d-avatars-${width}.png` });
			// Leaving and returning disposes and recreates the shared renderer cleanly.
			await page.locator('.throne-occupant button').click();
			await page.getByRole('dialog').getByRole('link', { name: 'Xem tài khoản' }).click();
			await page.goBack();
			await expect(figure).toHaveAttribute('data-avatar', 'photo');
			expect(errors).toEqual([]);
		});

		test('royal court synchronizes a rope pull with bound hands and a delayed body reaction', async ({
			page
		}) => {
			await page.clock.install();
			await openFixture(page, '/leaderboard');
			await expect(page.locator('.figure-model[data-renderer="3d"]')).toHaveCount(5);
			await page.locator('.palace-stage').scrollIntoViewIfNeeded();
			const king = page.locator('.throne-occupant .figure-model');
			const servants = page.locator('.servant .figure-model');
			await expect(king).toHaveAttribute('data-motion', 'idle');
			for (const servant of await servants.all())
				await expect(servant).toHaveAttribute('data-motion', 'idle');
			const advanceTo = async (phase: number) => {
				const current = await page.evaluate(() => (performance.now() / 1000) % 5);
				await page.clock.fastForward(((phase - current + 5) % 5) * 1000);
				await page.clock.runFor(33);
			};
			await advanceTo(1.9);
			const rest = await king.evaluate((canvas: HTMLCanvasElement) => canvas.toDataURL());
			await expect(king).toHaveAttribute('data-gesture', 'idle');
			await advanceTo(2.1);
			await expect(king).toHaveAttribute('data-gesture', 'pulling');
			for (const servant of await servants.all())
				await expect(servant).toHaveAttribute('data-gesture', 'idle');
			await advanceTo(2.25);
			await expect(king).toHaveAttribute('data-gesture', 'pulling');
			for (const servant of await servants.all())
				await expect(servant).toHaveAttribute('data-gesture', 'jerked');
			expect(await king.evaluate((canvas: HTMLCanvasElement) => canvas.toDataURL())).not.toBe(rest);
			await page.locator('.palace-stage').screenshot({ path: `artifacts/court-pulling-${width}.png` });
			await advanceTo(3.9);
			await expect(king).toHaveAttribute('data-gesture', 'idle');
			for (const servant of await servants.all())
				await expect(servant).toHaveAttribute('data-gesture', 'idle');
			const frames = await page.locator('.throne-occupant .rope-anchor').evaluateHandle((anchor) => {
				const result = { count: 0 };
				const observer = new MutationObserver(() => {
					result.count++;
				});
				observer.observe(anchor, { attributes: true, attributeFilter: ['style'] });
				return { result, stop: () => observer.disconnect() };
			});
			await page.clock.runFor(1000);
			expect(await frames.evaluate((state) => state.result.count)).toBeGreaterThanOrEqual(50);
			await frames.evaluate((state) => state.stop());
		});

		test('royal court retains models across 15-second polls and balance updates', async ({ page }) => {
			await page.clock.install();
			const { state } = await openFixture(page, '/leaderboard');
			await expect(page.locator('.figure-model[data-renderer="3d"]')).toHaveCount(5);
			const ids = () =>
				page
					.locator('.figure-model')
					.evaluateAll((elements) => elements.map((el) => (el as HTMLElement).dataset.modelId));
			const originalIds = await ids();
			const flashes = await page.evaluateHandle(() => {
				const result = { count: 0 };
				new MutationObserver((records) => {
					result.count += records.filter((record) => record.attributeName === 'data-renderer').length;
				}).observe(document.querySelector('.palace-world')!, {
					subtree: true,
					attributes: true,
					attributeFilter: ['data-renderer']
				});
				return result;
			});
			for (let poll = 0; poll < 3; poll++) {
				// A full state response with fresh objects must not rebuild an unchanged model.
				const response = page.waitForResponse((response) =>
					response.url().includes('/api/groups/local/state')
				);
				await page.clock.fastForward(15000);
				await response;
				await page.evaluate(async () => {
					for (let i = 0; i < 3; i++) await new Promise(requestAnimationFrame);
				});
				expect(await ids()).toEqual(originalIds);
			}
			state.ledger.push({ ...state.ledger[0], id: 'same-tier-increase', amount: 1000 });
			await page.clock.fastForward(15000);
			await expect(page.locator('.rank-row').first().locator('.rank-balance strong')).toHaveText('41.000 ₫');
			expect(await ids()).toEqual(originalIds);
			expect(await flashes.evaluate((result) => result.count)).toBe(0);
			// A genuine appearance change still replaces the affected model.
			state.members.find((member) => member.id === 'linh')!.color = '#cf5048';
			await page.clock.fastForward(15000);
			await expect
				.poll(() => page.locator('.throne-occupant .figure-model').getAttribute('data-model-id'))
				.not.toBe(originalIds[0]);
			await expect(page.locator('.throne-occupant .figure-model')).toHaveAttribute('data-renderer', '3d');
		});

		test('royal court keeps member selection usable without WebGL', async ({ page }) => {
			await page.addInitScript(() => {
				const getContext = HTMLCanvasElement.prototype.getContext;
				Object.defineProperty(HTMLCanvasElement.prototype, 'getContext', {
					value(type: string, ...args: unknown[]) {
						return type.startsWith('webgl') ? null : Reflect.apply(getContext, this, [type, ...args]);
					}
				});
			});
			await openFixture(page, '/leaderboard');
			await expect(page.locator('.throne-occupant .fallback-face')).toBeVisible();
			await page.locator('.throne-occupant button').click();
			await expect(page.getByRole('dialog')).toContainText('Thảo Linh');
		});

		test('overview payment history shows the newest creation first', async ({ page }) => {
			await openFixture(page, '/overview', (state) => {
				const base = { ...state.ledger[0], source: 'qr' as const, from: ACTOR, to: 'linh' };
				state.ledger = [
					{
						...base,
						id: 'old',
						description: 'Older creation',
						date: '2030-01-01T00:00:00.000Z',
						createdAt: '2026-10-27T05:00:00.000Z'
					},
					{
						...base,
						id: 'new',
						description: 'Newest creation',
						date: '2020-01-01T00:00:00.000Z',
						createdAt: '2026-10-29T05:00:00.000Z'
					},
					{ ...base, id: 'legacy', description: 'Legacy entry', date: '2026-10-28T05:00:00.000Z' }
				];
			});
			await expect(page.locator('.payment-history-row small')).toHaveText([
				/Newest creation$/,
				/Legacy entry$/,
				/Older creation$/
			]);
		});

		test('balance rows stay unhighlighted and keep long names away from actions', async ({ page }) => {
			if (width < 760) await page.setViewportSize({ width: 375, height: 667 });
			const longName = 'Thảo Linh ' + 'TênRấtDài'.repeat(15);
			await openFixture(page, '/balances', (state) => {
				state.members.find((member) => member.id === 'linh')!.name = longName;
			});
			const row = page
				.locator('.counterpart')
				.filter({ has: page.locator('.counterpart-name', { hasText: longName }) });
			const main = row.locator('.counterpart-main');
			await main.evaluate((element) => element.scrollIntoView({ block: 'center' }));
			const background = await main.evaluate((element) => getComputedStyle(element).backgroundColor);
			const bounds = (await row.boundingBox())!;
			const mainBounds = (await main.boundingBox())!;
			expect(Math.abs(mainBounds.x - bounds.x)).toBeLessThanOrEqual(1);
			expect(Math.abs(mainBounds.width - bounds.width)).toBeLessThanOrEqual(1);
			await page.mouse.move(bounds.x + 2, bounds.y + 2);
			await expect
				.poll(() => main.evaluate((element) => getComputedStyle(element).backgroundColor))
				.toBe(background);
			if (width < 760) {
				const actions = (await row.locator('.counterpart-actions').boundingBox())!;
				const name = (await row.locator('.counterpart-name').boundingBox())!;
				expect(name.x + name.width).toBeLessThanOrEqual(actions.x);
				expect(actions.x + actions.width).toBeLessThanOrEqual(bounds.x + bounds.width);
				expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(375);
			}
			await page.screenshot({ path: `artifacts/balance-layout-${width}.png` });
		});

		test('page zoom gestures are blocked only on mobile while single-finger scrolling is allowed', async ({
			page
		}) => {
			await openFixture(page, '/');
			const result = await page.evaluate(() => {
				const gesture = new Event('gesturestart', { bubbles: true, cancelable: true });
				document.dispatchEvent(gesture);
				const touches = [1, 2].map(
					(identifier) =>
						new Touch({ identifier, target: document.body, clientX: identifier * 50, clientY: 200 })
				);
				const pinch = new TouchEvent('touchmove', { touches, bubbles: true, cancelable: true });
				document.dispatchEvent(pinch);
				const scroll = new TouchEvent('touchmove', {
					touches: touches.slice(0, 1),
					bubbles: true,
					cancelable: true
				});
				document.dispatchEvent(scroll);
				return {
					gesture: gesture.defaultPrevented,
					pinch: pinch.defaultPrevented,
					scroll: scroll.defaultPrevented
				};
			});
			expect(result).toEqual({ gesture: width < 760, pinch: width < 760, scroll: false });
		});

		test.describe('sidebar gestures', () => {
			test.use({ hasTouch: true });
			test('only a rightward swipe from the left edge opens the phone sidebar', async ({
				page,
				browserName
			}) => {
				await openFixture(page, '/balances');
				await expect(page.getByRole('button', { name: 'Changelog', exact: true })).toHaveCount(0);
				const toggle = page.getByRole('button', { name: 'Mở trình đơn', exact: true });
				const sidebar = page.locator('#main-sidebar');
				const swipe = (
					from: [number, number],
					to: [number, number],
					options: { cancel?: boolean; multiple?: boolean; selector?: string } = {}
				) =>
					page.evaluate(
						({ from, to, options }) => {
							const target = options.selector
								? document.querySelector(options.selector)!
								: document.elementFromPoint(...from)!;
							const makeTouch = (point: [number, number], identifier = 1) =>
								({
									identifier,
									target,
									clientX: point[0],
									clientY: point[1],
									pageX: point[0],
									pageY: point[1],
									screenX: point[0],
									screenY: point[1],
									radiusX: 1,
									radiusY: 1,
									rotationAngle: 0,
									force: 1
								}) as Touch;
							const dispatch = (type: string, touches: Touch[], changedTouches: Touch[]) => {
								const event = new Event(type, { bubbles: true, cancelable: true });
								Object.defineProperties(event, {
									touches: { value: touches },
									targetTouches: { value: touches },
									changedTouches: { value: changedTouches }
								});
								target.dispatchEvent(event);
								return event;
							};
							const begin = makeTouch(from),
								finish = makeTouch(to);
							const start = dispatch('touchstart', [begin], [begin]);
							if (options.cancel) dispatch('touchcancel', [], [begin]);
							dispatch('touchmove', options.multiple ? [finish, makeTouch(to, 2)] : [finish], [finish]);
							if (options.cancel) dispatch('touchcancel', [], [finish]);
							dispatch('touchend', [], [finish]);
							return start.defaultPrevented;
						},
						{ from, to, options }
					);
				for (const [from, to, options] of [
					[[150, 240], [280, 245], {}],
					[[10, 240], [10, 380], {}],
					[[10, 240], [50, 245], {}],
					[[20, 240], [0, 240], {}],
					[[10, 240], [140, 245], { cancel: true }],
					[[10, 240], [140, 245], { multiple: true }]
				] as const) {
					await swipe([...from], [...to], options);
					await expect(sidebar).not.toHaveClass(/mobile-open/);
				}
				const reserved = await swipe([10, 240], [140, 245]);
				expect(reserved).toBe(width < 760);
				if (width > 760) {
					await expect(sidebar).not.toHaveClass(/mobile-open/);
					return;
				}
				await expect(toggle).toHaveAttribute('aria-expanded', 'true');
				await expect(sidebar).toHaveClass(/mobile-open/);
				await page.keyboard.press('Escape');
				await expect(toggle).toHaveAttribute('aria-expanded', 'false');
				const hitArea = (await toggle.boundingBox())!;
				expect(hitArea.width).toBeGreaterThanOrEqual(44);
				expect(hitArea.height).toBeGreaterThanOrEqual(44);
				await toggle.tap({ position: { x: 4, y: 22 } });
				await expect(toggle).toHaveAttribute('aria-expanded', 'true');
				await page.keyboard.press('Escape');
				await toggle.locator('svg').tap();
				await expect(toggle).toHaveAttribute('aria-expanded', 'true');
				await page.keyboard.press('Escape');
				await swipe([34, 300], [94, 345], { selector: '.counterpart-row-toggle' });
				await expect(toggle).toHaveAttribute('aria-expanded', 'true');
				await page.keyboard.press('Escape');
				if (browserName === 'chromium') {
					const touch = await page.context().newCDPSession(page);
					await touch.send('Input.dispatchTouchEvent', {
						type: 'touchStart',
						touchPoints: [{ x: 32, y: 240 }]
					});
					await page.waitForTimeout(900); // A deliberate slow swipe must still work.
					for (const [x, y] of [
						[45, 250],
						[62, 263],
						[85, 277],
						[110, 292]
					])
						await touch.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y }] });
					await touch.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
					await expect(toggle).toHaveAttribute('aria-expanded', 'true');
					await touch.detach();
				} else await swipe([10, 240], [140, 245]);
				await sidebar.getByRole('link', { name: 'Thành viên & quản lý', exact: true }).click();
				await expect(page.getByRole('heading', { name: 'Thành viên & quản lý', exact: true })).toBeVisible();
				await expect(toggle).toHaveAttribute('aria-expanded', 'false');
				await page.goto('/matrix');
				await expect(page.locator('.matrix-panel .table-scroll')).toBeVisible();
				expect(await swipe([20, 400], [140, 405], { selector: '.matrix-panel .table-scroll' })).toBe(false);
				await expect(sidebar).not.toHaveClass(/mobile-open/);
				await page.getByRole('button', { name: 'Tài khoản', exact: true }).click();
				await page.getByRole('menuitem', { name: 'Thông tin tài khoản', exact: true }).click();
				await expect(page.getByRole('dialog', { name: 'Thông tin tài khoản', exact: true })).toBeVisible();
				expect(await swipe([10, 240], [140, 245], { selector: 'main' })).toBe(false);
				await expect(sidebar).not.toHaveClass(/mobile-open/);
			});
		});

		if (width < 760) {
			test('phone bars stay fixed at both page boundaries with native overscroll enabled', async ({
				page
			}) => {
				await page.setViewportSize({ width: 375, height: 667 });
				await openFixture(page, '/balances');
				const header = page.locator('.topbar');
				const bottomBar = page.locator('.mobile-camera-bar');
				await expect(header).toHaveCSS('position', 'fixed');
				await expect(bottomBar).toHaveCSS('position', 'fixed');
				const heading = (await page
					.getByRole('heading', { name: 'Tài khoản của bạn', exact: true })
					.boundingBox())!;
				expect(heading.y).toBeGreaterThanOrEqual((await header.boundingBox())!.height);
				await page.mouse.move(180, 350);
				for (const delta of [-10000, 10000, 10000, -10000]) {
					await page.mouse.wheel(0, delta);
					await expect
						.poll(() => page.evaluate(() => window.scrollY))
						.toBe(
							delta > 0
								? await page.evaluate(() => document.documentElement.scrollHeight - window.innerHeight)
								: 0
						);
					await expect.poll(async () => (await header.boundingBox())!.y).toBe(0);
					const bottomBounds = (await bottomBar.boundingBox())!;
					expect(bottomBounds.y + bottomBounds.height).toBe(667);
					await expect(header.getByRole('button', { name: 'Mở trình đơn', exact: true })).toBeInViewport();
				}
				await expect(page.locator('html')).toHaveCSS('overscroll-behavior-y', 'auto');
				await header.getByRole('button', { name: 'Mở trình đơn', exact: true }).click();
				await expect(page.locator('aside')).toHaveClass(/mobile-open/);
			});

			test('royal court fits long names and large balances on a narrow phone', async ({ page }) => {
				await page.setViewportSize({ width: 320, height: 667 });
				const longName = 'Thảo Linh ' + 'TênRấtDài'.repeat(20);
				await openFixture(page, '/leaderboard', (state) => {
					state.members.find((member) => member.id === 'linh')!.name = longName;
					state.ledger[0].amount = 1000000000;
				});
				await expect(page.locator('.throne-occupant')).toContainText(longName);
				expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(320);
				await page.locator('.rank-row').first().click();
				await expect(page.getByRole('dialog')).toContainText(longName);
				expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(320);
			});
			test('bottom navigation has four links around the camera and replaces browser history', async ({
				page
			}) => {
				await page.setViewportSize({ width: 375, height: 667 });
				await openFixture(page, '/balances');
				const navigation = page.getByRole('navigation', { name: 'Điều hướng nhanh', exact: true });
				await expect(navigation.getByRole('link')).toHaveCount(4);
				const length = await page.evaluate(() => history.length);
				for (const [name, path, heading] of [
					['Tạo hoá đơn', '/new-bill', 'Tạo hoá đơn'],
					['Tổng quan', '/overview', 'Tổng quan'],
					['Ma trận nợ nần', '/matrix', 'Ma trận nợ nần'],
					['Tài khoản của bạn', '/balances', 'Tài khoản của bạn']
				]) {
					await navigation.getByRole('link', { name, exact: true }).click();
					await expect(page).toHaveURL(new RegExp(`${path}$`));
					await expect(page.getByRole('heading', { name: heading, exact: true })).toBeVisible();
					await expect(navigation.getByRole('link', { name, exact: true })).toHaveAttribute(
						'aria-current',
						'page'
					);
					expect(await page.evaluate(() => history.length)).toBe(length);
				}
				const camera = (await page
					.getByRole('button', { name: 'Chụp ảnh hóa đơn', exact: true })
					.boundingBox())!;
				expect(Math.abs(camera.x + camera.width / 2 - 375 / 2)).toBeLessThan(1);
				await page.screenshot({ path: 'artifacts/mobile-bottom-navigation.png' });
			});
		}

		if (width > 760) {
			test('mobile camera shortcut is hidden on desktop', async ({ page }) => {
				await openFixture(page, '/');
				await expect(page.locator('.mobile-bill-camera')).toBeHidden();
			});
		} else {
			for (const aiEnabled of [false, true]) {
				test(`mobile camera opens the composer, attaches photos and ${aiEnabled ? 'reads them with AI' : 'preserves manual entry without AI'}`, async ({
					page
				}) => {
					const { image } = await openFixture(page, '/overview', undefined, { aiEnabled });
					let uploads = 0;
					let scans = 0;
					let savedBills = 0;
					let releaseUpload!: () => void;
					const uploadGate = new Promise<void>((resolve) => {
						releaseUpload = resolve;
					});
					await page.route('**/api/groups/local/images', async (route) => {
						uploads++;
						await uploadGate;
						if (!aiEnabled && uploads === 2)
							return route.fulfill({ status: 503, json: { message: 'Không tải được ảnh. Hãy thử lại.' } });
						return route.fulfill({ json: { imageId: '3f2504e0-4f89-41d3-9a0c-0305e82c3301.png' } });
					});
					await page.route('**/api/groups/local/ai/scan', (route) => {
						scans++;
						if (scans > 1)
							return route.fulfill({
								status: 503,
								json: { message: 'AI đang bận. Bạn có thể nhập thủ công.' }
							});
						return route.fulfill({
							json: { billName: 'Hóa đơn từ camera', totalCost: 125000, billDate: '2026-10-28' }
						});
					});
					await page.route('**/api/groups/local/commands/createBill', (route) => {
						savedBills++;
						return route.abort();
					});
					await page.evaluate(
						(actor) =>
							localStorage.setItem(
								`lunchroom-draft-local-${actor}`,
								JSON.stringify({
									description: 'Bản nháp camera',
									selected: [actor, 'linh'],
									amounts: { [actor]: 30, linh: 55 },
									mode: 'manual',
									unit: 1000
								})
							),
						ACTOR
					);
					const camera = page.getByRole('button', { name: 'Chụp ảnh hóa đơn', exact: true });
					await expect(camera).toBeVisible();
					await expect(page.getByLabel('Chụp ảnh hóa đơn bằng camera', { exact: true })).toHaveAttribute(
						'capture',
						'environment'
					);
					const box = (await camera.boundingBox())!;
					expect(Math.abs(box.x + box.width / 2 - width / 2)).toBeLessThan(1);
					expect(844 - box.y - box.height).toBe(20);
					await page.screenshot({ path: `artifacts/mobile-camera-${aiEnabled ? 'ai' : 'manual'}.png` });
					let [chooser] = await Promise.all([page.waitForEvent('filechooser'), camera.click()]);
					await chooser.setFiles([]);
					await expect(page).toHaveURL(/\/overview$/);
					expect(uploads).toBe(0);
					[chooser] = await Promise.all([page.waitForEvent('filechooser'), camera.click()]);
					await chooser.setFiles({ name: 'camera.png', mimeType: 'image/png', buffer: image });
					try {
						await expect(page).toHaveURL(/\/new-bill$/);
						await expect(camera).toBeDisabled();
					} finally {
						releaseUpload();
					}
					await expect(page.locator('.bill-image-attached img')).toHaveJSProperty('naturalWidth', 1200);
					await expect(camera).toBeEnabled();
					await expect(page.getByLabel('Tên hóa đơn', { exact: true })).toHaveValue(
						aiEnabled ? 'Hóa đơn từ camera' : 'Bản nháp camera'
					);
					if (aiEnabled) {
						await expect(page.getByLabel('Tổng tiền cần chia', { exact: true })).toHaveValue('125');
						await expect(page.locator('.ai-scan-notice')).toContainText('AI đã điền tên');
					} else {
						await expect(page.getByLabel('Số tiền của Thảo Linh', { exact: true })).toHaveValue('55');
					}
					expect(uploads).toBe(1);
					expect(scans).toBe(aiEnabled ? 1 : 0);
					await page.reload();
					await expect(page.locator('.bill-image-attached img')).toHaveJSProperty('naturalWidth', 1200);
					expect(uploads).toBe(1);
					expect(scans).toBe(aiEnabled ? 1 : 0);
					// The same camera input works again from the composer; errors keep its attachment/draft.
					[chooser] = await Promise.all([page.waitForEvent('filechooser'), camera.click()]);
					await chooser.setFiles({ name: 'camera.png', mimeType: 'image/png', buffer: image });
					await expect(page.getByRole('alert')).toContainText(
						aiEnabled ? 'AI đang bận' : 'Không tải được ảnh'
					);
					await expect(page.locator('.bill-image-attached img')).toHaveJSProperty('naturalWidth', 1200);
					await expect(camera).toBeEnabled();
					if (!aiEnabled) {
						[chooser] = await Promise.all([page.waitForEvent('filechooser'), camera.click()]);
						await chooser.setFiles({ name: 'camera.png', mimeType: 'image/png', buffer: image });
						await expect(page.getByRole('alert')).toHaveCount(0);
						await expect(camera).toBeEnabled();
						expect(uploads).toBe(3);
						expect(scans).toBe(0);
					}
					expect(savedBills).toBe(0);
				});
			}
		}

		test('account filters use net debts and all shows only active people including zero balances', async ({
			page
		}) => {
			await openFixture(page);
			await expect(page.locator('.stat-card').nth(0)).toContainText('Bạn đang nợ');
			await expect(page.locator('.stat-card').nth(0)).toContainText('110.000 ₫');
			await expect(page.locator('.stat-card').nth(1)).toContainText('Bạn đang bị nợ');
			await expect(page.locator('.stat-card').nth(1)).toContainText('20.000 ₫');
			await expect(page.locator('.stat-card')).toHaveCount(2);
			const firstTile = (await page.locator('.stat-card').nth(0).boundingBox())!;
			const secondTile = (await page.locator('.stat-card').nth(1).boundingBox())!;
			expect(Math.abs(firstTile.y - secondTile.y)).toBeLessThan(1);
			if (width < 760) await expect(page.locator('.main-shell > footer')).toBeHidden();
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
			await page.locator('aside nav a[href="/matrix"]').click();
			const header = page.getByRole('columnheader', { name: 'Minh An, Tổng cộng: -40.000 ₫', exact: true });
			await expect(header).toBeVisible();
			await expect(header.locator('.matrix-net')).toHaveText('-40.000 ₫');
			const totalsMatch = () =>
				page.locator('.matrix-table').evaluate((table) => {
					const amount = (el: Element) => Number(el.textContent!.replace(/[^\d-]/g, ''));
					const rows = [...table.querySelectorAll('tbody tr')];
					return [...table.querySelectorAll('.matrix-net')].every(
						(total, index) =>
							amount(total) === rows.reduce((sum, row) => sum + amount(row.querySelectorAll('td')[index]), 0)
					);
				});
			expect(await totalsMatch()).toBe(true);
			await expect(
				page.getByRole('columnheader', { name: 'Ngọc Mai, Tổng cộng: 0 ₫', exact: true })
			).toBeAttached();
			await expect(
				page.locator('.matrix-net-row').getByRole('rowheader', { name: 'Tổng cộng', exact: true })
			).toBeVisible();
			await expect(page.locator('.matrix-table thead tr').first().locator('.matrix-net')).toHaveCount(0);
			await expect(page.locator('.matrix-table thead .matrix-net')).toHaveCount(8);
			await expect(page.locator('.matrix-corner')).toContainText('Chủ nợ');
			await expect(page.locator('.matrix-corner')).toContainText('Con nợ');
			await expect(page.locator('.matrix-corner')).not.toContainText(/[↓→]/);
			await expect(
				page
					.locator('.matrix-table tbody tr')
					.filter({ has: page.getByRole('rowheader', { name: 'Minh An', exact: true }) })
					.locator('td')
			).toHaveCount(8);
			await expect(page.locator('.matrix-table tbody .matrix-net')).toHaveCount(0);
			await page.locator('.matrix-panel').screenshot({ path: `artifacts/matrix-column-totals-${width}.png` });
		});

		if (width === 390) {
			test('long matrix names leave room for horizontal scrolling on an iPhone 6 viewport', async ({
				page
			}) => {
				await page.setViewportSize({ width: 375, height: 667 });
				const longName = 'Minh ' + 'TênRấtDài'.repeat(18);
				await openFixture(page, '/matrix', (state) => {
					state.members.find((member) => member.id === ACTOR)!.name = longName;
					state.members.find((member) => member.id === 'linh')!.name = 'Thảo ' + 'TênKhácRấtDài'.repeat(15);
				});
				const heading = page.getByRole('rowheader', { name: longName, exact: true });
				await expect(heading).toHaveAttribute('title', longName);
				const before = (await heading.boundingBox())!;
				expect(before.width).toBeLessThanOrEqual(145);
				const clipped = await heading
					.locator('span')
					.evaluate((element) => ({ width: element.clientWidth, text: element.scrollWidth }));
				expect(clipped.text).toBeGreaterThan(clipped.width);
				expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(375);
				await page.screenshot({ path: 'artifacts/iphone6-matrix-long-names.png' });
				const scroll = page.locator('.matrix-panel .table-scroll');
				await scroll.evaluate((element) => {
					element.scrollLeft = element.scrollWidth;
				});
				expect(await scroll.evaluate((element) => element.scrollLeft)).toBeGreaterThan(0);
				expect(Math.abs((await heading.boundingBox())!.x - before.x)).toBeLessThanOrEqual(1);
				await expect(page.locator('.matrix-table tbody tr').first().locator('td').last()).toBeInViewport();
				await page.screenshot({ path: 'artifacts/iphone6-matrix-scrolled.png' });
				await page.evaluate(() => (document.documentElement.dataset.theme = 'dark'));
				await page.screenshot({ path: 'artifacts/iphone6-matrix-dark.png' });
			});
		}

		test('matrix tooltips explain actual debts on hover and keyboard focus', async ({ page }) => {
			await openFixture(page, '/matrix');
			const row = page
				.locator('.matrix-table tbody tr')
				.filter({ has: page.getByRole('rowheader', { name: 'Minh An', exact: true }) });
			const owing = row.getByRole('button', { name: 'Minh An nợ Thảo Linh 40.000 ₫', exact: true });
			const tooltip = page.getByRole('tooltip');
			await owing.scrollIntoViewIfNeeded();
			const numberBounds = (await owing.boundingBox())!;
			const textWidth = await owing.evaluate((button) => {
				const text = document.createRange();
				text.selectNodeContents(button);
				return text.getBoundingClientRect().width;
			});
			expect(numberBounds.width - textWidth).toBeLessThan(1);
			await page.mouse.move(
				numberBounds.x + numberBounds.width + 2,
				numberBounds.y + numberBounds.height / 2
			);
			await expect(tooltip).toHaveCount(0);
			await owing.hover();
			await expect(tooltip).toHaveText('Minh An nợ Thảo Linh 40.000 ₫');
			const bounds = (await tooltip.boundingBox())!;
			expect(bounds.x).toBeGreaterThanOrEqual(0);
			expect(bounds.x + bounds.width).toBeLessThanOrEqual(page.viewportSize()!.width);
			const side = await tooltip.getAttribute('data-side');
			expect(['right', 'left']).toContain(side);
			const gap =
				side === 'right'
					? bounds.x - numberBounds.x - numberBounds.width
					: numberBounds.x - bounds.x - bounds.width;
			expect(gap).toBeCloseTo(4, 0);
			const owed = row.getByRole('button', { name: 'Quang Huy nợ Minh An 20.000 ₫', exact: true });
			await owed.scrollIntoViewIfNeeded();
			await page.mouse.move(0, 0);
			await owed.hover();
			await expect(tooltip).toHaveText('Quang Huy nợ Minh An 20.000 ₫');
			const zero = row.getByRole('cell', { name: '0 ₫', exact: true }).first();
			await expect(zero.getByRole('button')).toHaveCount(0);
			await zero.hover();
			await expect(tooltip).toHaveCount(0);
			await page.mouse.move(0, 0);
			await owing.scrollIntoViewIfNeeded();
			await owing.focus();
			await expect(tooltip).toHaveText('Minh An nợ Thảo Linh 40.000 ₫');
			await page.keyboard.press('Escape');
			await expect(tooltip).toHaveCount(0);
		});

		test('matrix total extremes use cyan and purple, including ties but excluding zero', async ({ page }) => {
			const { state } = await openFixture(page, '/matrix', (state) => {
				state.ledger = [
					{ ...state.ledger[0], id: 'first-extreme', from: ACTOR, to: 'linh', amount: 100000 },
					{ ...state.ledger[0], id: 'second-extreme', from: 'huy', to: 'nam', amount: 100000 }
				];
			});
			const lowest = page.locator('.matrix-net.net-lowest');
			const highest = page.locator('.matrix-net.net-highest');
			await expect(lowest).toHaveCount(2);
			await expect(highest).toHaveCount(2);
			await page.evaluate(() => (document.documentElement.dataset.theme = 'light'));
			await expect(lowest.first()).toHaveCSS('color', 'rgb(0, 125, 153)');
			await expect(highest.first()).toHaveCSS('color', 'rgb(152, 42, 199)');
			await page.evaluate(() => (document.documentElement.dataset.theme = 'dark'));
			await expect(lowest.first()).toHaveCSS('color', 'rgb(94, 228, 239)');
			await expect(highest.first()).toHaveCSS('color', 'rgb(214, 138, 255)');
			state.ledger = [];
			await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
			await expect(lowest).toHaveCount(0);
			await expect(highest).toHaveCount(0);
		});

		test('admins can cancel, retry and undo a simplification from its history', async ({ page }) => {
			let originalPairs: number[] = [];
			const { state } = await openFixture(page, '/matrix', (state) => {
				originalPairs = state.members.flatMap((a) =>
					state.members.map((b) => pairBalance(state.ledger, a.id, b.id))
				);
				applyCommand(state, ACTOR, 'settleDebts', { id: 'ui-simplification', version: state.version }, now);
			});
			const beforeUndo = structuredClone(state.ledger);
			let requests = 0;
			await page.route('**/api/groups/local/commands/undoSettlement', async (route) => {
				requests++;
				if (requests === 1)
					return route.fulfill({ status: 503, json: { message: 'Chưa hoàn tác được. Thử lại.' } });
				const input = route.request().postDataJSON();
				expect(input).toEqual({ id: 'ui-simplification' });
				const result = applyCommand(state, ACTOR, 'undoSettlement', input, now);
				await route.fulfill({ json: { state, result } });
			});
			const history = page.locator('[data-settlement-id="ui-simplification"]');
			const openUndo = history.getByRole('button', { name: 'Hoàn tác tối giản', exact: true });
			await openUndo.click();
			const confirmation = page.getByRole('dialog', { name: 'Hoàn tác tối giản nợ', exact: true });
			await expect(confirmation).toContainText('giao dịch bù trừ');
			await expect(confirmation).not.toContainText('bút toán');
			await confirmation.getByRole('button', { name: 'Hủy', exact: true }).click();
			expect(requests).toBe(0);
			expect(state.ledger).toEqual(beforeUndo);
			await openUndo.click();
			await confirmation.getByRole('button', { name: 'Xác nhận hoàn tác', exact: true }).click();
			await expect(page.locator('.error-toast')).toContainText('Thử lại');
			await expect(confirmation).toBeVisible();
			expect(state.ledger).toEqual(beforeUndo);
			await confirmation.getByRole('button', { name: 'Xác nhận hoàn tác', exact: true }).click();
			await expect(confirmation).toHaveCount(0);
			await expect(history).toContainText('Đã hoàn tác bởi Minh An');
			await expect(openUndo).toHaveCount(0);
			expect(state.ledger.slice(0, beforeUndo.length)).toEqual(beforeUndo);
			expect(
				state.members.flatMap((a) => state.members.map((b) => pairBalance(state.ledger, a.id, b.id)))
			).toEqual(originalPairs);
			await page.reload();
			await expect(history).toContainText('Đã hoàn tác bởi Minh An');
			await expect(openUndo).toHaveCount(0);
			await page.goto('/members');
			await page.getByRole('button', { name: 'Lịch sử thay đổi', exact: true }).click();
			await expect(page.locator('.audit-table')).toContainText('Hoàn tác tối giản nợ');
		});

		test('regular group members see simplification history without undo actions', async ({ page }) => {
			await openFixture(page, '/matrix', (state) => {
				applyCommand(state, ACTOR, 'settleDebts', { id: 'member-history', version: state.version }, now);
				state.members.find((member) => member.id === ACTOR)!.role = 'member';
			});
			await expect(page.locator('[data-settlement-id="member-history"]')).toBeVisible();
			await expect(page.getByRole('button', { name: 'Hoàn tác tối giản', exact: true })).toHaveCount(0);
		});

		test('admins can reach older simplifications beyond the five most recent', async ({ page }) => {
			await openFixture(page, '/matrix', (state) => {
				for (let i = 0; i < 6; i++)
					applyCommand(
						state,
						ACTOR,
						'settleDebts',
						{ id: `older-${i}`, version: state.version },
						new Date(Date.parse(now) + i * 60000).toISOString()
					);
			});
			await expect(page.locator('.settlement-history')).toHaveCount(5);
			await page.getByRole('button', { name: 'Xem thêm', exact: true }).click();
			const older = page.locator('[data-settlement-id="older-0"]');
			await older.getByRole('button', { name: 'Hoàn tác tối giản', exact: true }).click();
			await expect(page.getByRole('dialog', { name: 'Hoàn tác tối giản nợ', exact: true })).toBeVisible();
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
			// The decorative chevron forwards clicks to the full-row history toggle.
			const chevron = (await huy.locator('.counterpart-history-chevron').boundingBox())!;
			await page.mouse.click(chevron.x + chevron.width / 2, chevron.y + chevron.height / 2);
			await expect(page.locator('.counterpart-history')).toHaveCount(2);
			await linh.screenshot({ path: `artifacts/balance-history-${width}.png` });
			await expect(
				linh.getByRole('button', { name: 'Xem lịch sử với Thảo Linh', exact: true })
			).toHaveAttribute('aria-expanded', 'true');
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
			await linh.getByRole('button', { name: 'Xem lịch sử với Thảo Linh', exact: true }).click();
			await expect(linh.locator('.counterpart-history')).toHaveCount(0);
			await expect(huy.locator('.counterpart-history')).toBeVisible();
		});

		test('recent debt entries open their original bill when it is available', async ({ page }) => {
			await openFixture(page, '/balances', (state) => {
				state.bills.push({
					...state.bills[0],
					id: 'owe-linh',
					organizer: 'linh',
					creator: 'linh',
					description: 'Bữa trưa văn phòng',
					total: 100000,
					undoneAt: undefined,
					undoneBy: undefined,
					lines: [{ memberId: ACTOR, amount: 100000, description: 'Cơm gà và nước', note: '' }]
				});
				state.ledger[0].description = 'Cơm gà và nước';
				state.ledger[1].source = 'manual';
				state.ledger[1].reference = 'owe-linh';
				state.ledger[1].description = 'Khoản nợ ghi tay';
			});
			const linh = page.locator('.counterpart').filter({ hasText: 'Thảo Linh' });
			await linh.getByRole('button', { name: 'Xem lịch sử với Thảo Linh', exact: true }).click();
			const openBill = linh.getByRole('button', { name: 'Xem hóa đơn Bữa trưa văn phòng', exact: true });
			await openBill.focus();
			await page.keyboard.press('Enter');
			const detail = page.getByRole('dialog', { name: 'Bữa trưa văn phòng', exact: true });
			await expect(detail).toBeVisible();
			await expect(detail).toContainText('Thảo Linh thanh toán');
			await expect(detail).toContainText('Cơm gà và nước');
			await expect(detail.locator('.summary-total strong')).toHaveText('100.000 ₫');
			await expect(detail.locator('.bill-image img')).toBeVisible();
			await expect(page).toHaveURL(/\/balances$/);
			await page.keyboard.press('Escape');
			await expect(detail).toHaveCount(0);
			await expect(linh.locator('.counterpart-history')).toBeVisible();
			await expect(
				linh.locator('.counterpart-history-entry').filter({ hasText: 'Khoản nợ ghi tay' }).getByRole('button')
			).toHaveCount(0);
			const huy = page.locator('.counterpart').filter({ hasText: 'Quang Huy' });
			await huy.getByRole('button', { name: 'Xem lịch sử với Quang Huy', exact: true }).click();
			await expect(huy.locator('.counterpart-history-entry')).toHaveCount(1);
			await expect(huy.locator('.counterpart-history-entry').getByRole('button')).toHaveCount(0);
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
			await recipient.getByRole('button', { name: 'Xem lịch sử với Minh An', exact: true }).click();
			await expect(recipient.locator('.counterpart-history')).toContainText('Quang Huy nợ Minh An');
			await page.locator('main').screenshot({ path: 'artifacts/member-balances-admin-' + width + '.png' });
			await recipient.getByRole('button', { name: 'Mã QR', exact: true }).click();
			const dialog = page.getByRole('dialog', { name: 'Chuyển tiền bằng QR', exact: true });
			await expect(dialog).toContainText('Người trả: Quang Huy');
			await expect(dialog.locator('.qr-bank-link')).toHaveCount(0);
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
				['/overview', 'Tổng quan'],
				['/new-bill', 'Tạo hoá đơn'],
				['/balances', 'Tài khoản của bạn'],
				['/activity', 'Ledger']
			]) {
				if (width < 768) await page.getByRole('button', { name: 'Mở trình đơn', exact: true }).click();
				await page.locator(`aside nav a[href="${path}"]`).click();
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

		test('receipt images and fullscreen zoom stay stable across polling refreshes', async ({ page }) => {
			let imageRequests = 0;
			page.on('request', (request) => {
				if (request.url().includes('/api/groups/local/images/')) imageRequests++;
			});
			const { state } = await openFixture(page, '/activity?bill=receipt');
			const thumbnail = page.locator('.bill-detail-image img');
			await expect(thumbnail).toHaveJSProperty('naturalWidth', 1200);
			const originalUrl = await thumbnail.getAttribute('src');
			const refresh = async () => {
				state.ledger.push({ ...state.ledger[0], id: `refresh-${state.version}` });
				state.version++;
				const response = page.waitForResponse((response) =>
					response.url().includes('/api/groups/local/state')
				);
				await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
				await response;
				await expect(page.locator('.filter-toolbar')).toContainText(`Giao dịch (${state.ledger.length})`);
			};
			await refresh();
			await expect(thumbnail).toHaveAttribute('src', originalUrl!);
			expect(imageRequests).toBe(1);
			await page.getByRole('button', { name: 'Xem ảnh hóa đơn toàn màn hình', exact: true }).click();
			const lightbox = page.getByRole('dialog', { name: 'Ảnh hóa đơn toàn màn hình', exact: true });
			await lightbox.getByRole('button', { name: 'Phóng to ảnh hóa đơn', exact: true }).click();
			for (let i = 0; i < 2; i++) {
				await refresh();
				await expect(lightbox).toBeVisible();
				await expect(
					lightbox.getByRole('button', { name: 'Thu nhỏ ảnh hóa đơn', exact: true })
				).toHaveAttribute('aria-pressed', 'true');
				await expect(lightbox.locator('img')).toHaveAttribute('src', originalUrl!);
			}
			expect(imageRequests).toBe(1);
			state.bills[0].image = '4f2504e0-4f89-41d3-9a0c-0305e82c3302.png';
			await refresh();
			await expect(lightbox).toHaveCount(0);
			await expect(thumbnail).toHaveJSProperty('naturalWidth', 1200);
			await expect(thumbnail).not.toHaveAttribute('src', originalUrl!);
			expect(imageRequests).toBe(2);
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

		test('successful bill submission clears the form and draft while a failed save preserves them', async ({
			page
		}) => {
			const { state } = await openFixture(page, '/new-bill');
			const draftKey = `lunchroom-draft-local-${ACTOR}`;
			const draft = {
				description: 'Hóa đơn cần xóa sau khi lưu',
				date: '2026-10-15',
				selected: [ACTOR, 'huy'],
				payerId: 'linh',
				amounts: { [ACTOR]: 45000, huy: 55000 },
				descriptions: { [ACTOR]: 'Cơm gà', huy: 'Cơm cá' },
				mode: 'manual',
				totalInput: 90000,
				discountInput: 80001,
				rounding: 0,
				unit: 1,
				alreadyPaid: true,
				imageId: '3f2504e0-4f89-41d3-9a0c-0305e82c3301.png',
				submissionId: 'bill-reset-regression'
			};
			await page.evaluate(({ key, value }) => localStorage.setItem(key, JSON.stringify(value)), {
				key: draftKey,
				value: draft
			});
			await page.reload();
			const name = page.getByLabel('Tên hóa đơn', { exact: true });
			await expect(name).toHaveValue(draft.description);
			const originalNameField = await name.elementHandle();
			const ids: string[] = [];
			await page.route('**/api/groups/local/commands/createBill', async (route) => {
				const input = route.request().postDataJSON();
				ids.push(input.id);
				if (ids.length === 1)
					return route.fulfill({ status: 503, json: { message: 'Không lưu được hóa đơn. Thử lại.' } });
				const result = applyCommand(state, ACTOR, 'createBill', input, now);
				await route.fulfill({ json: { state, result } });
			});
			await page.getByRole('button', { name: 'Xem lại hóa đơn', exact: true }).click();
			const confirmation = page.getByRole('dialog', { name: 'Xác nhận hóa đơn', exact: true });
			await confirmation.getByRole('button', { name: 'Xác nhận', exact: true }).click();
			await expect(page.locator('.error-toast')).toContainText('Thử lại');
			await expect(confirmation).toBeVisible();
			await expect(name).toHaveValue(draft.description);
			expect(await page.evaluate((key) => JSON.parse(localStorage.getItem(key)!), draftKey)).toMatchObject(
				draft
			);
			await confirmation.getByRole('button', { name: 'Xác nhận', exact: true }).click();
			await expect(page).toHaveURL(/\/activity$/);
			expect(ids).toEqual([draft.submissionId, draft.submissionId]);
			expect(await page.evaluate((key) => localStorage.getItem(key), draftKey)).toBeNull();
			// Clear the live form before navigation, as well as the stored draft.
			expect(await originalNameField!.evaluate((input) => (input as HTMLInputElement).value)).toBe('');
			if (width < 768) await page.getByRole('button', { name: 'Mở trình đơn', exact: true }).click();
			await page.locator('aside nav a[href="/new-bill"]').click();
			await expect(name).toHaveValue('');
			await expect(page.getByLabel('Ngày thanh toán', { exact: true })).toHaveValue(localDate(new Date()));
			await expect(page.getByRole('combobox', { name: 'Người thanh toán', exact: true })).toHaveValue(ACTOR);
			await expect(page.locator('.member-picker button[aria-pressed="true"]')).toHaveCount(1);
			await expect(page.locator('.member-picker button[aria-pressed="true"]')).toContainText('Minh An');
			await expect(page.getByLabel('Số tiền của Minh An', { exact: true })).toHaveValue('');
			await expect(page.getByLabel('Món ăn của Minh An', { exact: true })).toHaveValue('');
			await expect(page.getByLabel('Giá sau khi giảm giá', { exact: true })).toHaveValue('');
			await expect(
				page
					.getByRole('group', { name: 'Đơn vị', exact: true })
					.getByRole('button', { name: 'Nghìn đồng', exact: true })
			).toHaveAttribute('aria-pressed', 'true');
			await expect(
				page.getByRole('switch', { name: 'Mọi người đã thanh toán', exact: true })
			).not.toBeChecked();
			await expect(page.getByRole('button', { name: 'Bỏ ảnh hóa đơn', exact: true })).toHaveCount(0);
			await expect(page.locator('.bill-summary .summary-total strong')).toHaveText('0 ₫');
			await expect
				.poll(() => page.evaluate((key) => JSON.parse(localStorage.getItem(key)!), draftKey))
				.toMatchObject({
					amounts: {},
					descriptions: {},
					totalInput: null,
					discountInput: null,
					imageId: '',
					rounding: 0,
					mode: 'manual'
				});
			const freshId = await page.evaluate(
				(key) => JSON.parse(localStorage.getItem(key)!).submissionId,
				draftKey
			);
			expect(freshId).not.toBe(draft.submissionId);
			await name.fill('Hóa đơn tiếp theo');
			await expect
				.poll(() => page.evaluate((key) => JSON.parse(localStorage.getItem(key)!).description, draftKey))
				.toBe('Hóa đơn tiếp theo');
			await page.reload();
			await expect(name).toHaveValue('Hóa đơn tiếp theo');
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
			await page.locator('aside nav a[href="/new-bill"]').click();
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
			await page.locator('aside nav a[href="/new-bill"]').click();
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

		test('split modes carry over the final price without changing individual prices', async ({ page }) => {
			await openFixture(page, '/new-bill');
			const individual = page.getByLabel('Số tiền của Minh An', { exact: true });
			await individual.fill('120');
			await page.getByRole('button', { name: 'Chia đều', exact: true }).click();
			const equal = page.getByLabel('Tổng tiền cần chia', { exact: true });
			await equal.fill('100.001');
			await page.getByRole('button', { name: 'Nhập từng người', exact: true }).click();
			const discount = page.getByLabel('Giá sau khi giảm giá', { exact: true });
			await expect(discount).toHaveValue('100.001');
			await expect(individual).toHaveValue('120');
			await page
				.getByRole('group', { name: 'Đơn vị', exact: true })
				.getByRole('button', { name: 'Đồng', exact: true })
				.click();
			await discount.fill('80001');
			await page.getByRole('button', { name: 'Chia đều', exact: true }).click();
			await expect(equal).toHaveValue('80001');
			await page.reload();
			await expect(equal).toHaveValue('80001');
			await page.getByRole('button', { name: 'Nhập từng người', exact: true }).click();
			await expect(discount).toHaveValue('80001');
			await expect(individual).toHaveValue('120000');
			await page.getByRole('button', { name: 'Chia đều', exact: true }).click();
			await equal.fill('');
			await page.getByRole('button', { name: 'Nhập từng người', exact: true }).click();
			await expect(discount).toHaveValue('');
		});

		test('discounted bills highlight missing participant prices instead of the discounted total', async ({
			page
		}) => {
			await openFixture(page, '/new-bill');
			await page.getByLabel('Tên hóa đơn', { exact: true }).fill('Hóa đơn thiếu giá');
			for (const name of ['Thảo Linh', 'Quang Huy', 'Ngọc Mai'])
				await page.locator('.member-picker').getByRole('button', { name, exact: true }).click();
			for (const name of ['Minh An', 'Thảo Linh', 'Quang Huy'])
				await page.getByLabel(`Số tiền của ${name}`, { exact: true }).fill('30');
			const discount = page.getByLabel('Giá sau khi giảm giá', { exact: true });
			const missingPrice = page.getByLabel('Số tiền của Ngọc Mai', { exact: true });
			await discount.fill('70');
			await expect(discount).toHaveAttribute('aria-invalid', 'false');
			await expect(missingPrice).toHaveAttribute('aria-invalid', 'true');
			await page.getByRole('combobox', { name: 'Làm tròn lên mỗi phần', exact: true }).selectOption('0');
			// A missing last price can still receive a positive remainder; it must not pass validation.
			await expect(page.locator('.discounted-share').last()).toHaveText('→ 1 ₫');
			await page.getByRole('button', { name: 'Xem lại hóa đơn', exact: true }).click();
			await expect(page.getByRole('dialog')).toHaveCount(0);
			await expect(page.getByRole('alert')).toHaveText('Mỗi người được chọn cần có số tiền lớn hơn 0.');
			await expect(discount).toHaveAttribute('aria-invalid', 'false');
			await missingPrice.fill('30');
			await expect(missingPrice).toHaveAttribute('aria-invalid', 'false');
			const middlePrice = page.getByLabel('Số tiền của Thảo Linh', { exact: true });
			await middlePrice.fill('');
			await expect(middlePrice).toHaveAttribute('aria-invalid', 'true');
			await expect(discount).toHaveAttribute('aria-invalid', 'false');
			await page.getByRole('button', { name: 'Xem lại hóa đơn', exact: true }).click();
			await expect(page.getByRole('dialog')).toHaveCount(0);
			await middlePrice.fill('30');
			await expect(middlePrice).toHaveAttribute('aria-invalid', 'false');
			await page.getByRole('button', { name: 'Xem lại hóa đơn', exact: true }).click();
			await expect(page.getByRole('dialog', { name: 'Xác nhận hóa đơn', exact: true })).toBeVisible();
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
				await expect(rounding).toHaveValue('0');
				await expect(page.locator('.summary-total strong')).toHaveText(
					mode === 'manual' ? '80.001 ₫' : '100.001 ₫'
				);
				await rounding.selectOption('3');
				await page.reload();
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
			await openFixture(page, '/overview', (state) => {
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

		test('monthly spending bars select the calendar month across windows, including empty months', async ({
			page
		}) => {
			const currentMonth = localDate(new Date()).slice(0, 7);
			const oldest = new Date(`${currentMonth}-01T00:00:00Z`);
			oldest.setUTCMonth(oldest.getUTCMonth() - 5);
			const oldestMonth = oldest.toISOString().slice(0, 7);
			await openFixture(page, '/overview', (state) => {
				const bill = state.bills[0];
				delete bill.undoneAt;
				delete bill.undoneBy;
				bill.date = `${currentMonth}-05T12:00:00Z`;
				bill.memberNames = { [ACTOR]: 'Tên cũ' };
				state.members.find((member) => member.id === ACTOR)!.name = 'Tên hiện tại';
				state.bills.push({
					...bill,
					id: 'old-month',
					date: `${oldestMonth}-05T12:00:00Z`,
					description: 'Hóa đơn tháng cũ'
				});
			});
			const monthLabel = page.locator('.cal-month strong');
			const bars = page.locator('button.chart-column');
			const monthText = (key: string) => `Tháng ${Number(key.slice(5, 7))}/${key.slice(0, 4)}`;
			await expect(bars).toHaveCount(6);
			await bars.first().locator('.bar').click();
			await expect(monthLabel).toHaveText(monthText(oldestMonth));
			await expect(page.locator('.cal-subtitle')).toHaveText('30.000 ₫');
			await expect(page.locator('.cal-bill')).toContainText('Hóa đơn tháng cũ');
			await expect(page.locator('.cal-bill')).toHaveAttribute('title', /Người trả: Tên hiện tại/);
			await expect(page.locator('.cal-payer')).toHaveText('tại');
			await expect(page.getByRole('button', { name: 'Tên hiện tại', exact: true })).toBeVisible();
			await expect(bars.first()).toHaveAttribute('aria-pressed', 'true');
			await page.getByRole('button', { name: 'Tháng sau', exact: true }).click();
			await expect(bars.first()).toHaveAttribute('aria-pressed', 'false');
			await bars.first().focus();
			await page.keyboard.press('Enter');
			await expect(monthLabel).toHaveText(monthText(oldestMonth));
			await bars.nth(1).click();
			await expect(bars.nth(1)).toHaveAttribute('aria-pressed', 'true');
			await expect(page.locator('.cal-subtitle')).toHaveText('0 ₫');
			await expect(page.locator('.cal-bill')).toHaveCount(0);
			await page.getByRole('button', { name: 'Khoảng trước', exact: true }).click();
			const earlier = new Date(oldest);
			earlier.setUTCMonth(earlier.getUTCMonth() - 1);
			await bars.last().click();
			await expect(monthLabel).toHaveText(monthText(earlier.toISOString().slice(0, 7)));
			await page.getByRole('button', { name: 'Khoảng sau', exact: true }).click();
			await bars.last().click();
			await expect(monthLabel).toHaveText(monthText(currentMonth));
			await expect(page.locator('.cal-subtitle')).toHaveText('30.000 ₫');
			await expect(page.locator('.cal-bill')).toContainText('Hóa đơn mẫu');
			await page.locator('.spending-panel').screenshot({ path: `artifacts/month-bar-calendar-${width}.png` });
		});

		test('calendar browses future months and payment history links to the Transactions tab', async ({
			page
		}) => {
			await openFixture(page, '/overview', (state) => {
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
			await page.locator('aside nav a[href="/new-bill"]').click();
			await expect(page.locator('.bill-summary-heading')).toBeVisible();
			await page.getByLabel('Tên hóa đơn', { exact: true }).fill('Cơm trưa văn phòng');
			await page.locator('.bill-summary').screenshot({ path: `artifacts/bill-summary-heading-${width}.png` });
			await page.route('**/api/discord/guilds', (route) => route.fulfill({ json: { guilds: [] } }));
			if (width < 768) await page.getByRole('button', { name: 'Mở trình đơn', exact: true }).click();
			await page.locator('aside nav a[href="/groups"]').click();
			await expect(page.getByRole('heading', { name: 'Nhóm của bạn', exact: true })).toBeVisible();
			await page.locator('.groups-layout').screenshot({ path: `artifacts/group-headers-${width}.png` });
		});
	});
}

for (const [platform, userAgent] of [
	[
		'ios',
		'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1'
	],
	[
		'android',
		'Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 Chrome/130.0.0.0 Mobile Safari/537.36'
	]
]) {
	test.describe(`bank app on ${platform}`, () => {
		test.use({ userAgent, viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });

		test('tapping the QR opens your saved bank with the recipient and amount, without recording payment', async ({
			page,
			context
		}) => {
			const { state } = await openFixture(page, '/balances?group=local&to=nam', (state) => {
				state.members.find((member) => member.id === ACTOR)!.bankCode = '970418';
			});
			let commands = 0;
			await page.route('**/api/groups/local/commands/*', (route) => {
				commands++;
				return route.abort();
			});
			const dialog = page.getByRole('dialog', { name: 'Chuyển tiền bằng QR', exact: true });
			const link = dialog.getByRole('link', {
				name: 'Mở BIDV SmartBanking để chuyển 20.000 ₫ cho Hoàng Nam',
				exact: true
			});
			await expect(link).toBeVisible();
			const url = new URL((await link.getAttribute('href'))!);
			expect(url.searchParams.get('app')).toBe('bidv');
			expect(url.searchParams.get('ba')).toBe(
				`${state.members.find((member) => member.id === 'nam')!.bankAccount}@vcb`
			);
			expect(url.searchParams.get('am')).toBe('20000');
			expect(url.searchParams.get('tn')).toBe('Minh An tra tien an QR');
			expect(url.searchParams.get('url')).toBe('http://127.0.0.1:5173/balances?group=local');
			const qrImage = await link.locator('img').getAttribute('src');
			const recipient = state.members.find((member) => member.id === 'nam')!;
			recipient.bankCode = '970416';
			recipient.bankAccount = '999999';
			state.version++;
			await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
			await expect(link).toHaveAttribute('href', url.href);
			await expect(link.locator('img')).toHaveAttribute('src', qrImage!);
			// Never reach the real banking service with fixture details.
			await context.route('https://dl.vietqr.io/**', (route) =>
				route.fulfill({ contentType: 'text/html', body: '<p>Bank app handoff fixture</p>' })
			);
			const [popup] = await Promise.all([page.waitForEvent('popup'), link.click()]);
			await expect(popup).toHaveURL(url.href);
			await popup.close();
			await expect(dialog).toBeVisible();
			await expect(dialog.getByRole('checkbox')).not.toBeChecked();
			await expect(dialog.getByRole('button', { name: 'Đã thanh toán', exact: true })).toBeDisabled();
			expect(commands).toBe(0);
		});

		test('supports additional bank apps and explains when autofill is unavailable', async ({ page }) => {
			await openFixture(page, '/balances?to=nam', (state) => {
				state.members.find((member) => member.id === ACTOR)!.bankCode = '970416';
			});
			const dialog = page.getByRole('dialog', { name: 'Chuyển tiền bằng QR', exact: true });
			await expect(dialog.locator('.qr-bank-link')).toHaveAttribute('href', /app=acb&/);
			await dialog.getByRole('combobox', { name: 'Ứng dụng ngân hàng', exact: true }).selectOption('acb-biz');
			await expect(dialog.locator('.qr-bank-link')).toHaveAttribute('href', /app=acb-biz&/);
			await expect(dialog).toContainText('Ứng dụng này chưa hỗ trợ điền sẵn');
			await dialog.screenshot({ path: `artifacts/bank-app-${platform}.png` });
		});

		test('admin uses their own banking app even while viewing another member’s account', async ({ page }) => {
			await openFixture(page, `/balances?member=huy&to=${ACTOR}`, (state) => {
				state.members.find((member) => member.id === ACTOR)!.bankCode = '970422';
				state.members.find((member) => member.id === 'huy')!.bankCode = '970416';
			});
			const dialog = page.getByRole('dialog', { name: 'Chuyển tiền bằng QR', exact: true });
			const link = dialog.locator('.qr-bank-link');
			await expect(link).toBeVisible();
			const url = new URL((await link.getAttribute('href'))!);
			expect(url.searchParams.get('app')).toBe('mb');
			expect(url.searchParams.get('ba')).toMatch(/^000000001123@mb$/);
			expect(url.searchParams.get('am')).toBe('20000');
			expect(url.searchParams.get('url')).toBe('http://127.0.0.1:5173/balances?member=huy');
			await expect(dialog).toContainText('Người trả: Quang Huy');
		});

		test('keeps the QR usable when your saved bank is missing or has no app link', async ({ page }) => {
			const { state } = await openFixture(page, '/balances?to=nam', (state) => {
				state.members.find((member) => member.id === ACTOR)!.bankCode = '';
			});
			const dialog = page.getByRole('dialog', { name: 'Chuyển tiền bằng QR', exact: true });
			await expect(dialog.locator('img')).toBeVisible();
			await expect(dialog.locator('.qr-bank-link')).toHaveCount(0);
			await expect(dialog).toContainText('Cập nhật ngân hàng của bạn');
			state.members.find((member) => member.id === ACTOR)!.bankCode = '458761';
			state.version++;
			await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
			await expect(dialog).toContainText('Ngân hàng của bạn chưa hỗ trợ mở ứng dụng');
			await expect(dialog.locator('img')).toBeVisible();
			await expect(dialog.locator('.qr-bank-link')).toHaveCount(0);
		});
	});
}
