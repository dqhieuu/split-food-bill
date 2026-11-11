import { writable } from 'svelte/store';
import {
	updateSettlementFlowPreference,
	type AppState,
	type Group,
	type Session,
	type SettlementFlowUpdate
} from '../domain/types';
import type { GroupState } from './api';
import { ApiError } from './api-error';

type SessionApi = Pick<
	typeof import('./api'),
	| 'initializeAuth'
	| 'logout'
	| 'getSession'
	| 'selectGroup'
	| 'fetchState'
	| 'sendCommand'
	| 'saveDiscordNotificationPreference'
	| 'saveSettlementFlowPreference'
>;
type Snapshot = {
	session: Session | null;
	active: (GroupState & { command: (command: string, input: unknown) => Promise<string> }) | null;
	loading: boolean;
	busy: boolean;
	error: string;
};
type GroupContext = {
	selecting: boolean;
	commands: number;
	issued: number;
	applied: number;
};

const deniedLink = 'Bạn chưa được kích hoạt trong nhóm của liên kết này.';

export class GroupSessionChanged extends Error {
	constructor() {
		super('Nhóm hiện tại đã thay đổi.');
	}
}

export function createActiveGroupSession(api: SessionApi, requestedGroup: () => string | null) {
	let snapshot: Snapshot = { session: null, active: null, loading: true, busy: false, error: '' };
	const store = writable(snapshot);
	let context: GroupContext = { selecting: false, commands: 0, issued: 0, applied: 0 };
	let account = 0;
	let selectionWrites = Promise.resolve();
	let preferenceWrites = Promise.resolve();

	function publish(change: Partial<Snapshot>) {
		snapshot = { ...snapshot, ...change };
		store.set(snapshot);
	}

	function beginSelection(change: Partial<Snapshot> = {}) {
		const current: GroupContext = { selecting: true, commands: 0, issued: 0, applied: 0 };
		context = current;
		publish({ busy: true, error: '', ...change });
		return current;
	}

	function finishSelection(current: GroupContext) {
		if (current !== context) return;
		current.selecting = false;
		publish({ loading: false, busy: false });
	}

	function withGroup(session: Session, next: Group): Session {
		return {
			...session,
			groups: session.groups.map((group) =>
				group.id === next.id && group.version <= next.version ? { ...group, ...next } : group
			)
		};
	}

	function updateGroup(next: Group) {
		const { session, active } = snapshot;
		if (!session) return;
		publish({
			session: withGroup(session, next),
			active:
				active?.group.id === next.id && active.group.version <= next.version
					? { ...active, group: next }
					: active
		});
	}

	async function loadGroup(current: GroupContext, explicitId: string | null, isLink = false) {
		try {
			await preferenceWrites;
			if (current !== context) return false;
			const session = await api.getSession();
			if (current !== context) return false;
			const groupId = explicitId ?? session.selectedGroupId;
			if (snapshot.session && snapshot.session.user.id !== session.user.id) {
				account++;
				publish({ session, active: null });
			} else publish({ session });
			if (isLink && !session.groups.some((group) => group.id === groupId)) throw new Error(deniedLink);
			if (!groupId) {
				publish({ active: null });
				return false;
			}
			// The Worker remembers selection. Finish an earlier write before persisting a newer choice.
			const write = selectionWrites.then(async () => {
				if (current === context) await api.selectGroup(groupId);
			});
			selectionWrites = write.catch(() => {});
			await write;
			if (current !== context) return false;
			const active = await api.fetchState(groupId);
			if (current !== context) return false;
			if (active.group.id !== groupId || active.actor !== session.user.id)
				throw new Error('Không tải được dữ liệu của nhóm đã chọn.');
			const latest = withGroup(snapshot.session ?? session, active.group);
			const group = latest.groups.find((group) => group.id === groupId) ?? active.group;
			// Keep commands bound to the selection that supplied the view's data.
			publish({
				active: { ...active, group, command: (command, input) => send(groupId, command, input, current) },
				session: { ...latest, selectedGroupId: groupId }
			});
			return true;
		} catch (cause) {
			if (current !== context) return false;
			if (cause instanceof ApiError && cause.status === 401) await signOut();
			else {
				const error =
					isLink && cause instanceof ApiError && cause.status === 403 ? deniedLink : (cause as Error).message;
				publish({ active: null, error });
			}
			return false;
		} finally {
			finishSelection(current);
		}
	}

	async function initialize() {
		account++;
		const current = beginSelection({ active: null, loading: true });
		try {
			const auth = await api.initializeAuth();
			if (current !== context) return;
			if (auth.signedIn) {
				const groupId = requestedGroup();
				await loadGroup(current, groupId, !!groupId);
			} else publish({ session: null });
		} catch (cause) {
			if (current === context) publish({ error: (cause as Error).message });
		} finally {
			if (current.selecting) finishSelection(current);
		}
	}

	function select(groupId: string) {
		if (!snapshot.session || snapshot.loading) return Promise.resolve(false);
		return loadGroup(beginSelection(), groupId);
	}

	async function signOut() {
		account++;
		const current = beginSelection({ session: null, active: null, loading: true });
		try {
			await api.logout();
		} catch (cause) {
			if (current === context) publish({ error: (cause as Error).message });
		} finally {
			finishSelection(current);
		}
	}

	function acceptSnapshot(current: GroupContext, request: number, state: AppState, group?: Group) {
		const { active, session } = snapshot;
		if (current !== context || !active || !session) return;
		if (
			state.version < active.state.version ||
			(state.version === active.state.version && request < current.applied)
		)
			return;
		current.applied = Math.max(current.applied, request);
		publish({
			active: {
				...active,
				state,
				group: group && group.version >= active.group.version ? group : active.group
			},
			session: group ? withGroup(session, group) : session
		});
	}

	async function refresh() {
		const { active } = snapshot;
		const current = context;
		if (!active || current.selecting) return;
		const request = ++current.issued;
		const groupId = active.group.id;
		// Notification delivery can change receipts without bumping the ledger version.
		const delivering = active.state.receipts.some((receipt) =>
			['queued', 'sending'].includes(receipt.status)
		);
		try {
			const reply = await api.fetchState(groupId, delivering ? undefined : active.state.version);
			if (current !== context || reply.group.id !== groupId || reply.actor !== active.actor) return;
			if ('unchanged' in reply) {
				if (request >= current.applied) {
					current.applied = request;
					updateGroup(reply.group);
				}
			} else acceptSnapshot(current, request, reply.state, reply.group);
		} catch (cause) {
			if (current !== context || request < current.applied) return;
			if (cause instanceof ApiError && cause.status === 401) await signOut();
			else if (cause instanceof ApiError && cause.status === 403) {
				const linkedGroup = requestedGroup() === groupId ? groupId : null;
				await loadGroup(beginSelection({ active: null }), linkedGroup, !!linkedGroup);
			} else throw cause;
		}
	}

	async function send(groupId: string, command: string, input: unknown, current?: GroupContext) {
		const signedInAccount = account;
		if (!snapshot.session || (current && (current !== context || current.selecting)))
			throw new GroupSessionChanged();
		const activeContext = !context.selecting && snapshot.active?.group.id === groupId ? context : undefined;
		const request = activeContext ? ++activeContext.issued : 0;
		if (current) {
			current.commands++;
			publish({ busy: true });
		}
		try {
			const reply = await api.sendCommand(groupId, command, input);
			if (signedInAccount !== account || (current && current !== context)) throw new GroupSessionChanged();
			const { group } = reply;
			if (group && group.id !== groupId) throw new Error('Không tải được dữ liệu của nhóm đã chọn.');
			if (activeContext && activeContext === context)
				acceptSnapshot(activeContext, request, reply.state, group);
			else if (group) updateGroup(group);
			return reply.result.reference || 'ok';
		} catch (cause) {
			if (signedInAccount !== account || (current && current !== context)) throw new GroupSessionChanged();
			if (
				activeContext === context &&
				request >= context.applied &&
				cause instanceof ApiError &&
				(cause.status === 401 || cause.status === 403)
			)
				void refresh().catch(() => {});
			throw cause;
		} finally {
			if (current && current === context) {
				current.commands--;
				publish({ busy: current.commands > 0 });
			}
		}
	}

	async function changeDiscordNotificationPreference(enabled: boolean) {
		if (!snapshot.session) throw new GroupSessionChanged();
		const signedInAccount = account;
		const {
			preferences: { discordBillNotifications }
		} = await api.saveDiscordNotificationPreference(enabled);
		const { session } = snapshot;
		if (!session || account !== signedInAccount) return;
		const user = { ...session.user, preferences: { ...session.user.preferences, discordBillNotifications } };
		publish({ session: { ...session, user } });
	}

	function changeSettlementFlowPreference(groupId: string, change: SettlementFlowUpdate) {
		const { session } = snapshot;
		if (!session || snapshot.active?.group.id !== groupId) return Promise.resolve();
		const signedInAccount = account;
		const flow = session.user.preferences?.settlementFlow;
		const updated = updateSettlementFlowPreference(flow?.[groupId], change);
		const user = {
			...session.user,
			preferences: { ...session.user.preferences, settlementFlow: { ...flow, [groupId]: updated } }
		};
		publish({ session: { ...session, user } });
		const write = preferenceWrites.then(async () => {
			if (account === signedInAccount) await api.saveSettlementFlowPreference(groupId, change);
		});
		preferenceWrites = write.catch(() => {});
		return write.catch((cause: unknown) => {
			if (account === signedInAccount) throw cause;
		});
	}

	return {
		subscribe: store.subscribe,
		initialize,
		select,
		signOut,
		refresh,
		configure: (groupId: string, command: string, input: unknown) => send(groupId, command, input),
		changeDiscordNotificationPreference,
		changeSettlementFlowPreference
	};
}
