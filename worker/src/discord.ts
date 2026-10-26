import type { Env } from './env';
import { isLocal } from './env';
import { DomainError } from '../../src/lib/domain/ledger';

export type DiscordProfile = {
	id: string;
	username: string;
	global_name?: string | null;
	avatar?: string | null;
	email?: string;
	bot?: boolean;
};
type Role = { id: string; permissions: string };
type GuildMember = { user: DiscordProfile; roles: string[]; nick?: string; pending?: boolean };
export type Channel = {
	id: string;
	guild_id: string;
	name: string;
	type: number;
	permission_overwrites?: { id: string; type: number; allow: string; deny: string }[];
};
export const mockProfiles: DiscordProfile[] = [
	{ id: '100000000000000001', username: 'minhan', global_name: 'Minh An', email: 'an@example.test' },
	{ id: '100000000000000002', username: 'thaolinh', global_name: 'Thảo Linh', email: 'linh@example.test' },
	{ id: '100000000000000003', username: 'quanghuy', global_name: 'Quang Huy', email: 'huy@example.test' }
];
export function avatarUrl(user: DiscordProfile) {
	return user.avatar
		? `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.${user.avatar.startsWith('a_') ? 'gif' : 'png'}`
		: `https://cdn.discordapp.com/embed/avatars/${Number((BigInt(user.id) >> 22n) % 6n)}.png`;
}
export function canViewChannel(
	member: GuildMember,
	guild: { id: string; owner_id: string },
	roles: Role[],
	channel: Channel
) {
	if (member.user.id === guild.owner_id) return true;
	let permissions = roles
		.filter((role) => role.id === guild.id || member.roles.includes(role.id))
		.reduce((result, role) => result | BigInt(role.permissions), 0n);
	if ((permissions & 8n) !== 0n) return true;
	const overwrites = channel.permission_overwrites ?? [];
	const everyone = overwrites.find((entry) => entry.id === guild.id && entry.type === 0);
	if (everyone) permissions = (permissions & ~BigInt(everyone.deny)) | BigInt(everyone.allow);
	const roleOverwrites = overwrites.filter((entry) => entry.type === 0 && member.roles.includes(entry.id));
	permissions &= ~roleOverwrites.reduce((bits, entry) => bits | BigInt(entry.deny), 0n);
	permissions |= roleOverwrites.reduce((bits, entry) => bits | BigInt(entry.allow), 0n);
	const personal = overwrites.find((entry) => entry.type === 1 && entry.id === member.user.id);
	if (personal) permissions = (permissions & ~BigInt(personal.deny)) | BigInt(personal.allow);
	return (permissions & 1024n) !== 0n;
}
export class Discord {
	constructor(readonly env: Env) {}
	async api<T>(path: string, init: RequestInit = {}): Promise<T> {
		const response = await fetch(`https://discord.com/api/v10${path}`, {
			...init,
			headers: {
				authorization: `Bot ${this.env.DISCORD_BOT_TOKEN}`,
				'content-type': 'application/json',
				...init.headers
			}
		});
		if (!response.ok) {
			if (response.status === 429)
				throw new DomainError('Discord đang giới hạn yêu cầu. Vui lòng thử lại sau.', 429);
			throw new DomainError('Không truy cập được dữ liệu Discord. Kiểm tra quyền của bot.', 502);
		}
		return response.json() as Promise<T>;
	}
	async channels(): Promise<Channel[]> {
		if (isLocal(this.env))
			return [
				{ id: '200000000000000001', guild_id: '300000000000000001', name: 'ăn-trưa', type: 0 },
				{ id: '200000000000000002', guild_id: '300000000000000001', name: 'cà-phê', type: 0 }
			];
		const guilds: { id: string }[] = [];
		let after = '0';
		for (;;) {
			const page = await this.api<{ id: string }[]>(`/users/@me/guilds?limit=200&after=${after}`);
			guilds.push(...page);
			if (page.length < 200) break;
			after = page.reduce(
				(largest, guild) => (BigInt(guild.id) > BigInt(largest) ? guild.id : largest),
				after
			);
		}
		const allowed = this.env.DISCORD_GUILD_IDS?.split(',')
			.map((id) => id.trim())
			.filter(Boolean);
		const botUser = await this.api<DiscordProfile>('/users/@me');
		const channels: Channel[] = [];
		for (const guild of guilds.filter((guild) => !allowed?.length || allowed.includes(guild.id))) {
			const results = await this.api<Channel[]>(`/guilds/${guild.id}/channels`);
			const details = await this.api<{ id: string; owner_id: string }>(`/guilds/${guild.id}`);
			const roles = await this.api<Role[]>(`/guilds/${guild.id}/roles`);
			const bot = await this.api<GuildMember>(`/guilds/${guild.id}/members/${botUser.id}`);
			// Text/announcement channels only: thread and voice presence have different membership semantics.
			channels.push(
				...results
					.filter((channel) => [0, 5].includes(channel.type) && canViewChannel(bot, details, roles, channel))
					.map((channel) => ({ ...channel, guild_id: guild.id }))
			);
		}
		return channels;
	}
	async members(channelId: string): Promise<DiscordProfile[]> {
		const channel = (await this.channels()).find((channel) => channel.id === channelId);
		if (!channel) throw new DomainError('Kênh không được bot truy cập.', 404);
		if (isLocal(this.env)) return mockProfiles;
		const guild = await this.api<{ id: string; owner_id: string }>(`/guilds/${channel.guild_id}`);
		const roles = await this.api<Role[]>(`/guilds/${guild.id}/roles`);
		const members: GuildMember[] = [];
		let after = '0';
		for (;;) {
			const page = await this.api<GuildMember[]>(`/guilds/${guild.id}/members?limit=1000&after=${after}`);
			members.push(...page);
			if (page.length < 1000) break;
			after = page.reduce(
				(largest, member) => (BigInt(member.user.id) > BigInt(largest) ? member.user.id : largest),
				after
			);
		}
		return members
			.filter(
				(member) => !member.user.bot && !member.pending && canViewChannel(member, guild, roles, channel)
			)
			.map((member) => ({ ...member.user, global_name: member.nick || member.user.global_name }));
	}
	async dm(id: string, message: string) {
		if (isLocal(this.env)) return { status: 'simulated' as const };
		const channel = await this.api<{ id: string }>('/users/@me/channels', {
			method: 'POST',
			body: JSON.stringify({ recipient_id: id })
		});
		await this.api(`/channels/${channel.id}/messages`, {
			method: 'POST',
			body: JSON.stringify({ content: message, allowed_mentions: { parse: [] } })
		});
		return { status: 'sent' as const };
	}
}
