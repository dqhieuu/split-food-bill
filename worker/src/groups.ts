import { applyCommand, DomainError } from '../../src/lib/domain/ledger';
import {
	collectionKeys,
	type AppState,
	type GlobalUser,
	type Group,
	type GroupSummary,
	type Member
} from '../../src/lib/domain/types';
import { Store, type Write } from './store';
import { isLocal, type Env } from './env';
import { avatarUrl, Discord, type DiscordProfile } from './discord';

export const userId = (discordId: string) => `discord_${discordId}`;
export function profileUser(profile: DiscordProfile, existing: GlobalUser | null, env: Env): GlobalUser {
	const now = new Date().toISOString();
	return {
		id: userId(profile.id),
		discordId: profile.id,
		role: env.DISCORD_ADMIN_IDS?.split(',')
			.map((id) => id.trim())
			.includes(profile.id)
			? 'admin'
			: (existing?.role ?? 'member'),
		name: profile.global_name || profile.username,
		username: profile.username,
		avatarUrl: isLocal(env) ? '' : avatarUrl(profile),
		email: profile.email ?? existing?.email ?? '',
		createdAt: existing?.createdAt ?? now,
		updatedAt: now,
		...(existing?.lastActiveGroupId ? { lastActiveGroupId: existing.lastActiveGroupId } : {})
	};
}
export function groupMember(profile: DiscordProfile, env: Env): Member {
	return {
		id: userId(profile.id),
		name: profile.global_name || profile.username,
		email: profile.email ?? '',
		avatarUrl: isLocal(env) ? '' : avatarUrl(profile),
		active: false,
		role: 'member',
		bankCode: '',
		bankAccount: '',
		color: '#6c8b70'
	};
}
export async function requireGroup(
	store: Store,
	groupId: string,
	uid: string,
	admin = false,
	transaction?: string
) {
	if (!/^[\w-]{1,100}$/.test(groupId)) throw new DomainError('Nhóm không hợp lệ.', 400);
	const group = await store.get<Group>(`groups/${groupId}`, transaction);
	const member = await store.get<Member>(`groups/${groupId}/members/${uid}`, transaction);
	if (!group || !member?.active) throw new DomainError('Bạn chưa được kích hoạt trong nhóm này.', 403);
	if (admin && member.role !== 'admin')
		throw new DomainError('Chỉ quản trị viên của nhóm được thao tác.', 403);
	return { group, member };
}
export async function session(store: Store, user: GlobalUser) {
	const all = await store.list<Group>('groups');
	const groups: GroupSummary[] = [];
	for (const group of all) {
		const member = await store.get<Member>(`groups/${group.id}/members/${user.id}`);
		if (member?.active) groups.push({ ...group, role: member.role });
	}
	return {
		user,
		groups,
		selectedGroupId: groups.find((group) => group.id === user.lastActiveGroupId)?.id ?? groups[0]?.id ?? null
	};
}
async function readGroupState(store: Store, groupId: string, uid: string, transaction: string) {
	const { group } = await requireGroup(store, groupId, uid, false, transaction);
	const state = { version: group.version } as AppState;
	for (const key of collectionKeys)
		(state[key] as unknown[]) = await store.list(`groups/${groupId}/${key}`, transaction);
	return { group, state };
}
export async function loadGroup(store: Store, groupId: string, uid: string) {
	return store.transaction(async (tx) => ({
		...(await readGroupState(store, groupId, uid, tx)),
		actor: uid
	}));
}
export async function groupCommand(
	store: Store,
	groupId: string,
	uid: string,
	command: string,
	input: unknown
) {
	return store.transaction(async (tx, writes) => {
		const { group, state } = await readGroupState(store, groupId, uid, tx);
		if (command === 'saveMember') {
			const id = (input as { id?: string })?.id;
			if (!state.members.some((member) => member.id === id))
				throw new DomainError('Đồng bộ thành viên từ Discord trước khi chỉnh sửa.', 400);
			if (!/^discord_\d{17,20}$/.test(id ?? ''))
				throw new DomainError('ID thành viên phải lấy từ Discord.', 400);
		}
		const before = structuredClone(state);
		if (command === 'importLedger') {
			const entries = (input as { entries?: { from: string; to: string }[] })?.entries;
			if (
				!Array.isArray(entries) ||
				entries.some(
					(entry) =>
						!state.members.some((member) => member.id === entry.from) ||
						!state.members.some((member) => member.id === entry.to)
				)
			)
				throw new DomainError('Tệp nhập phải dùng ID Discord của thành viên đã có trong nhóm.', 400);
		}
		const result = applyCommand(state, uid, command, input);
		for (const key of collectionKeys) {
			const originals = new Map(before[key].map((entry) => [entry.id, JSON.stringify(entry)]));
			for (const entry of state[key])
				if (originals.get(entry.id) !== JSON.stringify(entry))
					writes.push(store.write(`groups/${groupId}/${key}/${entry.id}`, entry));
		}
		writes.push(store.write(`groups/${groupId}`, { ...group, version: state.version }));
		if (writes.length > 450)
			throw new DomainError('Thao tác có quá nhiều bản ghi. Hãy chia thành các lô nhỏ hơn.', 400);
		return { state, result, actor: uid, group: { ...group, version: state.version } };
	});
}
export async function createGroup(store: Store, user: GlobalUser, env: Env, name: string, guildId: string) {
	if (user.role !== 'admin') throw new DomainError('Chỉ quản trị viên hệ thống được tạo nhóm.', 403);
	const discord = new Discord(env);
	const guild = (await discord.guilds()).find((entry) => entry.id === guildId);
	if (!guild) throw new DomainError('Máy chủ Discord không hợp lệ.', 400);
	const profiles = await discord.members(guildId);
	if (profiles.length > 200)
		throw new DomainError('Nhóm hiện hỗ trợ tối đa 200 thành viên. Chọn máy chủ nhỏ hơn.', 400);
	const group: Group = {
		id: crypto.randomUUID(),
		name,
		discordGuildId: guildId,
		createdBy: user.id,
		createdAt: new Date().toISOString(),
		version: 1
	};
	return store.transaction(async (tx, writes) => {
		const current = await store.get<GlobalUser>(`users/${user.id}`, tx);
		if (current?.role !== 'admin') throw new DomainError('Bạn không có quyền tạo nhóm.', 403);
		if (await store.get(`discordGuilds/${guildId}`, tx))
			throw new DomainError('Máy chủ này đã liên kết với một nhóm.', 409);
		const members = profiles.map((profile) => groupMember(profile, env));
		const creator = members.find((member) => member.id === user.id);
		if (creator) {
			creator.active = true;
			creator.role = 'admin';
		} else
			members.push({
				id: user.id,
				name: user.name,
				email: user.email,
				avatarUrl: user.avatarUrl,
				active: true,
				role: 'admin',
				bankCode: '',
				bankAccount: '',
				color: '#44735a'
			});
		for (const profile of profiles) {
			const existing = await store.get<GlobalUser>(`users/${userId(profile.id)}`, tx);
			const member = members.find((entry) => entry.id === userId(profile.id))!;
			if (!member.email) member.email = existing?.email ?? '';
			if (!existing) writes.push(store.write(`users/${userId(profile.id)}`, profileUser(profile, null, env)));
		}
		writes.push(
			store.write(`groups/${group.id}`, group, true),
			store.write(`discordGuilds/${guildId}`, { guildId, groupId: group.id }, true)
		);
		for (const member of members) writes.push(store.write(`groups/${group.id}/members/${member.id}`, member));
		writes.push(store.write(`users/${user.id}`, { ...current, lastActiveGroupId: group.id }));
		if (writes.length > 450) throw new DomainError('Có quá nhiều thành viên mới cho một lần tạo nhóm.', 400);
		return group;
	});
}
export async function syncMembers(store: Store, env: Env, groupId: string, user: GlobalUser) {
	const { group } = await requireGroup(store, groupId, user.id, true);
	const profiles = await new Discord(env).members(group.discordGuildId);
	if (profiles.length > 200)
		throw new DomainError('Đồng bộ hiện hỗ trợ tối đa 200 thành viên mỗi máy chủ.', 400);
	await store.transaction(async (tx, writes) => {
		const { group: current } = await requireGroup(store, groupId, user.id, true, tx);
		for (const profile of profiles) {
			const uid = userId(profile.id);
			const member = await store.get<Member>(`groups/${groupId}/members/${uid}`, tx);
			const globalUser = await store.get<GlobalUser>(`users/${uid}`, tx);
			if (!member)
				writes.push(
					store.write(`groups/${groupId}/members/${uid}`, {
						...groupMember(profile, env),
						email: profile.email ?? globalUser?.email ?? ''
					})
				);
			if (!globalUser) writes.push(store.write(`users/${uid}`, profileUser(profile, null, env)));
		}
		writes.push(store.write(`groups/${groupId}`, { ...current, version: current.version + 1 }));
		const id = crypto.randomUUID();
		writes.push(
			store.write(`groups/${groupId}/audit/${id}`, {
				id,
				actor: user.id,
				action: 'syncDiscordMembers',
				reference: groupId,
				date: new Date().toISOString()
			})
		);
	});
	return loadGroup(store, groupId, user.id);
}
