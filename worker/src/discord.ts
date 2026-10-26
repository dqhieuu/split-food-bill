import type { Env } from './env';
import { isLocal } from './env';
import { DomainError } from '../../src/lib/domain/ledger';
import { sessionOperation } from './identity';

export class DiscordRateLimitError extends DomainError {
	constructor(readonly retryAfterSeconds: number) {
		super(`Discord đang giới hạn yêu cầu. Thử lại sau ${retryAfterSeconds} giây.`, 429);
	}
}

function retryDelay(response: Response, body?: { retry_after?: unknown }) {
	const values = [
		response.headers.get('retry-after'),
		body?.retry_after,
		response.headers.get('x-ratelimit-reset-after')
	]
		.filter((value) => value !== null && value !== undefined && value !== '')
		.map(Number)
		.filter((value) => Number.isFinite(value) && value >= 0);
	return values.length ? Math.max(...values) * 1000 : null;
}

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
	private guildList?: Promise<DiscordGuild[]>;
	private namespace?: Promise<string>;
	private async key(name: string) {
		this.namespace ??= crypto.subtle
			.digest('SHA-256', new TextEncoder().encode(this.env.DISCORD_BOT_TOKEN ?? ''))
			.then((digest) =>
				[...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
			);
		return `discord:${await this.namespace}:${name}`;
	}
	private async cached<T>(name: string, ttl: number, load: () => Promise<T>, refresh = false): Promise<T> {
		if (!this.env.AUTH_SESSIONS) return load();
		const key = await this.key(`cache:${name}`);
		const value = refresh ? null : await sessionOperation<T | null>(this.env, 'get', key);
		if (value !== null) return value;
		const result = await load();
		if (new TextEncoder().encode(JSON.stringify(result)).byteLength <= 64000)
			await sessionOperation(this.env, 'put', key, { ttl, value: result });
		return result;
	}
	private async cooldown(key: string, delay: number) {
		if (this.env.AUTH_SESSIONS && delay > 0)
			await sessionOperation(this.env, 'put', key, { ttl: delay, value: Date.now() + delay });
	}
	async api<T>(path: string, init: RequestInit = {}): Promise<T> {
		const method = init.method ?? 'GET';
		const route = `${method}:${path.split('?')[0]}`;
		const routeKey = await this.key(`rate:${route}`);
		const globalKey = await this.key('rate:global');
		let waited = 0;
		const wait = async (delay: number) => {
			if (delay > 2000 - waited) throw new DiscordRateLimitError(Math.max(1, Math.ceil(delay / 1000)));
			waited += delay;
			if (delay > 0) await new Promise((resolve) => setTimeout(resolve, delay));
		};
		for (let attempt = 0; attempt < 3; attempt++) {
			if (this.env.AUTH_SESSIONS) {
				const deadlines = await Promise.all(
					[routeKey, globalKey].map((key) => sessionOperation<number | null>(this.env, 'get', key))
				);
				await wait(Math.max(0, ...deadlines.map((deadline) => (deadline ?? 0) - Date.now())));
			}
			const response = await fetch(`https://discord.com/api/v10${path}`, {
				signal: AbortSignal.timeout(10000),
				...init,
				headers: {
					authorization: `Bot ${this.env.DISCORD_BOT_TOKEN}`,
					'user-agent': 'DiscordBot (https://github.com/dqhieuu/split-food-bill, 0.1.0)',
					'content-type': 'application/json',
					...init.headers
				}
			});
			if (response.status === 429) {
				const body = (await response.json().catch(() => ({}))) as {
					retry_after?: number;
					global?: boolean;
					code?: number;
				};
				const delay = retryDelay(response, body);
				const cooldown = Math.max(100, delay ?? 30000);
				await this.cooldown(
					body.global || response.headers.get('x-ratelimit-scope') === 'global' ? globalKey : routeKey,
					cooldown
				);
				console.warn('Discord rate limit', {
					route,
					retryAfterSeconds: cooldown / 1000,
					scope: response.headers.get('x-ratelimit-scope'),
					code: body.code
				});
				if (delay === null || attempt === 2)
					throw new DiscordRateLimitError(Math.max(1, Math.ceil(cooldown / 1000)));
				await wait(cooldown);
				continue;
			}
			if (response.headers.get('x-ratelimit-remaining') === '0')
				await this.cooldown(routeKey, retryDelay(response) ?? 0);
			if (!response.ok)
				throw new DomainError('Không truy cập được dữ liệu Discord. Kiểm tra quyền của bot.', 502);
			return response.json() as Promise<T>;
		}
		throw new DiscordRateLimitError(1);
	}
	async guilds(): Promise<DiscordGuild[]> {
		if (isLocal(this.env))
			return [
				{ id: '300000000000000001', name: 'Hội ăn trưa' },
				{ id: '300000000000000002', name: 'Cà phê' }
			];
		this.guildList ??= this.cached('guilds', 60000, async () => {
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
			return guilds;
		});
		const guilds = await this.guildList;
		const allowed = this.env.DISCORD_GUILD_IDS?.split(',')
			.map((id) => id.trim())
			.filter(Boolean);
		return guilds.filter((guild) => !allowed?.length || allowed.includes(guild.id));
	}
	async members(guildId: string, refresh = false): Promise<DiscordProfile[]> {
		if (!(await this.guilds()).some((guild) => guild.id === guildId))
			throw new DomainError('Bot chưa tham gia máy chủ này.', 404);
		if (isLocal(this.env)) return mockProfiles;
		return this.cached(
			`members:${guildId}`,
			30000,
			async () => {
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
			},
			refresh
		);
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
