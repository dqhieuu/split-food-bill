import { get } from 'svelte/store';
import { describe, expect, it, vi } from 'vitest';
import { createActiveGroupSession, GroupSessionChanged } from '../../src/lib/client/active-group-session';
import { ApiError } from '../../src/lib/client/api-error';
import type { GroupState } from '../../src/lib/client/api';
import { createDemoState } from '../../src/lib/domain/seed';
import type { AppState, GroupSummary, Receipt, Session } from '../../src/lib/domain/types';

type SessionApi = Parameters<typeof createActiveGroupSession>[0];
type StateReply = Awaited<ReturnType<SessionApi['fetchState']>>;
const date = '2026-11-12T01:00:00.000Z';
const user: Session['user'] = {
	id: 'an',
	discordId: '123',
	role: 'admin',
	name: 'An',
	username: 'an',
	avatarUrl: '',
	email: '',
	createdAt: date,
	updatedAt: date
};
const lunch: GroupSummary = {
	id: 'lunch',
	name: 'Lunch',
	discordGuildId: '1',
	createdBy: user.id,
	createdAt: date,
	version: 7,
	role: 'admin'
};
const dinner: GroupSummary = { ...lunch, id: 'dinner', name: 'Dinner', discordGuildId: '2', version: 1 };
const receipt: Receipt = {
	id: 'notification',
	billId: 'bill',
	status: 'queued',
	recipients: [],
	deliveries: [],
	attempts: 0,
	error: '',
	createdAt: date
};

function groupState(group: GroupSummary, fields: Partial<AppState> = {}): GroupState {
	return {
		group,
		actor: user.id,
		state: { ...createDemoState(new Date(date)), version: group.version, receipts: [], ...fields }
	};
}

function setup(link: string | null = null) {
	const fetchState = vi.fn<(groupId: string, since?: number) => Promise<StateReply>>(async (groupId) =>
		groupState(groupId === lunch.id ? lunch : dinner)
	);
	const api = {
		initializeAuth: vi.fn<SessionApi['initializeAuth']>().mockResolvedValue({
			signedIn: true,
			local: true,
			uid: user.id
		}),
		getSession: vi.fn<SessionApi['getSession']>().mockResolvedValue({
			user,
			groups: [lunch, dinner],
			selectedGroupId: lunch.id
		}),
		selectGroup: vi.fn<SessionApi['selectGroup']>().mockResolvedValue({ ok: true }),
		fetchState: fetchState as SessionApi['fetchState'],
		sendCommand: vi.fn<SessionApi['sendCommand']>(),
		logout: vi.fn<SessionApi['logout']>().mockResolvedValue(undefined),
		saveDiscordNotificationPreference: vi.fn<SessionApi['saveDiscordNotificationPreference']>(),
		saveSettlementFlowPreference: vi.fn<SessionApi['saveSettlementFlowPreference']>()
	};
	const session = createActiveGroupSession(api, () => link);
	return { session, api, fetchState, snapshot: () => get(session) };
}

describe('active group session', () => {
	it.each([200, 401, 403])(
		'discards a late response with status %i after switching groups',
		async (status) => {
			const { session, api, fetchState, snapshot } = setup();
			await session.initialize();
			const late = Promise.withResolvers<StateReply>();
			fetchState.mockReturnValueOnce(late.promise);
			const polling = session.refresh();
			await session.select(dinner.id);

			if (status === 200) late.resolve(groupState(lunch));
			else late.reject(new ApiError('Late denial', status));
			await polling;

			expect(snapshot().active).toMatchObject({ group: dinner, state: { version: dinner.version } });
			expect(snapshot().session?.selectedGroupId).toBe(dinner.id);
			expect(api.getSession).toHaveBeenCalledTimes(2);
			expect(api.logout).not.toHaveBeenCalled();
		}
	);

	it('keeps a newer command snapshot when an earlier poll arrives late', async () => {
		const { session, api, fetchState, snapshot } = setup();
		await session.initialize();
		const late = Promise.withResolvers<StateReply>();
		fetchState.mockReturnValueOnce(late.promise);
		const polling = session.refresh();
		const next = { ...lunch, version: lunch.version + 1 };
		api.sendCommand.mockResolvedValueOnce({ ...groupState(next), result: { reference: 'bill' } });
		await expect(snapshot().active!.command('createBill', {})).resolves.toBe('bill');
		late.resolve(groupState(lunch));
		await polling;
		expect(snapshot().active).toMatchObject({ group: next, state: { version: next.version } });
	});

	it('accepts a same-version delivery update and discards an older queued response', async () => {
		const { session, fetchState, snapshot } = setup();
		fetchState.mockResolvedValueOnce(groupState(lunch, { receipts: [receipt] }));
		await session.initialize();
		const late = Promise.withResolvers<StateReply>();
		fetchState.mockReturnValueOnce(late.promise);
		const polling = session.refresh();
		fetchState.mockResolvedValueOnce(groupState(lunch, { receipts: [{ ...receipt, status: 'sent' }] }));
		await session.refresh();
		expect(fetchState).toHaveBeenLastCalledWith(lunch.id, undefined);
		late.resolve(groupState(lunch, { receipts: [receipt] }));
		await polling;
		expect(snapshot().active!.state.receipts[0].status).toBe('sent');

		fetchState.mockResolvedValueOnce({ unchanged: true, group: lunch, actor: user.id });
		await session.refresh();
		expect(fetchState).toHaveBeenLastCalledWith(lunch.id, lunch.version);
		expect(snapshot().active!.state.receipts[0].status).toBe('sent');
	});

	it('invalidates both in-flight commands and commands retained by a previous view', async () => {
		const { session, api, snapshot } = setup();
		await session.initialize();
		const previousCommand = snapshot().active!.command;
		const late = Promise.withResolvers<Awaited<ReturnType<SessionApi['sendCommand']>>>();
		api.sendCommand.mockReturnValueOnce(late.promise);
		const sending = previousCommand('createBill', {});
		await session.select(dinner.id);
		await expect(previousCommand('createBill', {})).rejects.toBeInstanceOf(GroupSessionChanged);
		late.resolve({ ...groupState(lunch), result: { reference: 'bill' } });
		await expect(sending).rejects.toBeInstanceOf(GroupSessionChanged);
		expect(api.sendCommand).toHaveBeenCalledExactlyOnceWith(lunch.id, 'createBill', {});
		expect(snapshot().active?.group).toEqual(dinner);
		expect(snapshot().busy).toBe(false);
	});

	it('clears the active group on sign-out and ignores a pending refresh', async () => {
		const { session, api, fetchState, snapshot } = setup();
		await session.initialize();
		const late = Promise.withResolvers<StateReply>();
		fetchState.mockReturnValueOnce(late.promise);
		const polling = session.refresh();
		await session.signOut();
		await expect(session.select(dinner.id)).resolves.toBe(false);
		late.resolve(groupState(lunch));
		await polling;
		expect(api.logout).toHaveBeenCalledOnce();
		expect(api.selectGroup).toHaveBeenCalledExactlyOnceWith(lunch.id);
		expect(snapshot()).toMatchObject({ session: null, active: null, loading: false, busy: false });
	});

	it('shows access denied on a repayment link after revocation', async () => {
		const { session, api, fetchState, snapshot } = setup(lunch.id);
		await session.initialize();
		api.getSession.mockResolvedValueOnce({ user, groups: [dinner], selectedGroupId: dinner.id });
		fetchState.mockRejectedValueOnce(new ApiError('Group access revoked', 403));
		await session.refresh();
		expect(snapshot()).toMatchObject({
			active: null,
			busy: false,
			error: 'Bạn chưa được kích hoạt trong nhóm của liên kết này.',
			session: { groups: [dinner] }
		});
		expect(api.selectGroup).toHaveBeenCalledExactlyOnceWith(lunch.id);
	});

	it.each([dinner, null])('recovers an ordinary session to %j after revocation', async (fallback) => {
		const { session, api, fetchState, snapshot } = setup();
		await session.initialize();
		api.getSession.mockResolvedValueOnce({
			user,
			groups: fallback ? [fallback] : [],
			selectedGroupId: fallback?.id ?? null
		});
		fetchState.mockRejectedValueOnce(new ApiError('Group access revoked', 403));
		await session.refresh();
		expect(snapshot().active?.group ?? null).toEqual(fallback);
		expect(snapshot()).toMatchObject({ error: '', busy: false });
	});

	it('rechecks membership after a command 403 and keeps the group when access still works', async () => {
		const { session, api, fetchState, snapshot } = setup();
		await session.initialize();
		const forbidden = new ApiError('Command requires admin', 403);
		api.sendCommand.mockRejectedValueOnce(forbidden);
		fetchState.mockResolvedValueOnce({ unchanged: true, group: lunch, actor: user.id });
		await expect(snapshot().active!.command('settleDebts', {})).rejects.toBe(forbidden);
		expect(fetchState).toHaveBeenLastCalledWith(lunch.id, lunch.version);
		expect(snapshot().active?.group).toEqual(lunch);
		expect(api.getSession).toHaveBeenCalledOnce();
	});

	it('updates the active snapshot for configuration and only the picker for other groups', async () => {
		const { session, api, snapshot } = setup();
		await session.initialize();
		const renamedDinner = { ...dinner, name: 'New Dinner', version: 2 };
		api.sendCommand.mockResolvedValueOnce({ ...groupState(renamedDinner), result: {} });
		await session.configure(dinner.id, 'configureGroup', {});
		expect(snapshot().session?.groups).toEqual([lunch, renamedDinner]);
		expect(snapshot().active).toMatchObject({ group: lunch, state: { version: lunch.version } });

		const renamedLunch = { ...lunch, name: 'New Lunch', version: 8 };
		api.sendCommand.mockResolvedValueOnce({ ...groupState(renamedLunch), result: {} });
		await session.configure(lunch.id, 'configureGroup', {});
		expect(snapshot().active).toMatchObject({ group: renamedLunch, state: { version: 8 } });
	});

	it('persists overlapping selections in order and only activates the latest group', async () => {
		const { session, api, fetchState, snapshot } = setup();
		await session.initialize();
		const pendingWrite = Promise.withResolvers<{ ok: boolean }>();
		api.selectGroup.mockReturnValueOnce(pendingWrite.promise);
		const first = session.select(dinner.id);
		await vi.waitFor(() => expect(api.selectGroup).toHaveBeenLastCalledWith(dinner.id));
		const second = session.select(lunch.id);
		await vi.waitFor(() => expect(api.getSession).toHaveBeenCalledTimes(3));
		expect(api.selectGroup).toHaveBeenCalledTimes(2);
		pendingWrite.resolve({ ok: true });
		await expect(first).resolves.toBe(false);
		await expect(second).resolves.toBe(true);
		expect(api.selectGroup.mock.calls).toEqual([[lunch.id], [dinner.id], [lunch.id]]);
		expect(fetchState.mock.calls).toEqual([[lunch.id], [lunch.id]]);
		expect(snapshot().active?.group).toEqual(lunch);
	});
});
