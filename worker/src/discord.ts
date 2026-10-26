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
type GuildMember = { user: DiscordProfile; roles: string[]; nick?: string; pending?: boolean };
export type DiscordGuild = { id: string; name: string; icon?: string | null };
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
export class Discord {
	constructor(readonly env: Env) {}
	async api<T>(path: string, init: RequestInit = {}): Promise<T> {
		const response = await fetch(`https://discord.com/api/v10${path}`, {
			signal: AbortSignal.timeout(10000),
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
	async guilds(): Promise<DiscordGuild[]> {
		if (isLocal(this.env))
			return [
				{ id: '300000000000000001', name: 'Hội ăn trưa' },
				{ id: '300000000000000002', name: 'Cà phê' }
			];
		const guilds: DiscordGuild[] = [];
		let after = '0';
		for (;;) {
			const page = await this.api<DiscordGuild[]>(`/users/@me/guilds?limit=200&after=${after}`);
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
		return guilds.filter((guild) => !allowed?.length || allowed.includes(guild.id));
	}
	async members(guildId: string): Promise<DiscordProfile[]> {
		if (!(await this.guilds()).some((guild) => guild.id === guildId))
			throw new DomainError('Bot chưa tham gia máy chủ này.', 404);
		if (isLocal(this.env)) return mockProfiles;
		const members: GuildMember[] = [];
		let after = '0';
		for (;;) {
			const page = await this.api<GuildMember[]>(`/guilds/${guildId}/members?limit=1000&after=${after}`);
			members.push(...page);
			if (page.length < 1000) break;
			after = page.reduce(
				(largest, member) => (BigInt(member.user.id) > BigInt(largest) ? member.user.id : largest),
				after
			);
		}
		return members
			.filter((member) => !member.user.bot && !member.pending)
			.map((member) => ({ ...member.user, global_name: member.nick || member.user.global_name }));
	}
	async dm(id: string, message: string, nonce?: string) {
		if (isLocal(this.env)) return { status: 'simulated' as const };
		const channel = await this.api<{ id: string }>('/users/@me/channels', {
			method: 'POST',
			body: JSON.stringify({ recipient_id: id })
		});
		await this.api(`/channels/${channel.id}/messages`, {
			method: 'POST',
			body: JSON.stringify({
				content: message,
				allowed_mentions: { parse: [] },
				...(nonce ? { nonce, enforce_nonce: true } : {})
			})
		});
		return { status: 'sent' as const };
	}
}
