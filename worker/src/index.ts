import { z, ZodError } from 'zod';
import type { Env } from './env';
import { assertEnvironment, isLocal } from './env';
import { Store } from './store';
import { authenticatedUser, sessionOperation } from './identity';
import { oauth } from './oauth';
import { createGroup, groupCommand, loadGroup, requireGroup, session, syncMembers } from './groups';
import { Discord } from './discord';
import { DomainError } from '../../src/lib/domain/ledger';
import type { GlobalUser, Member } from '../../src/lib/domain/types';
export { AuthSessions } from './sessions';

const bodySchema = z.object({
	groupId: z.string().regex(/^[\w-]{1,100}$/),
	recipients: z
		.array(z.string().regex(/^discord_\d{17,20}$/))
		.min(1)
		.max(20),
	message: z.string().trim().min(1).max(2000),
	id: z.string().uuid()
});
async function route(request: Request, env: Env): Promise<Response> {
	const url = new URL(request.url);
	const store = new Store(env);
	if (url.pathname === '/health') return Response.json({ ok: true, mode: env.APP_ENV });
	if (url.pathname === '/config' && request.method === 'GET')
		return Response.json({
			mode: env.APP_ENV,
			firebase: {
				apiKey: env.FIREBASE_API_KEY,
				projectId: env.FIREBASE_PROJECT_ID,
				authDomain: env.FIREBASE_AUTH_DOMAIN
			},
			...(isLocal(env) ? { authEmulatorUrl: `http://${env.FIREBASE_AUTH_EMULATOR_HOST}` } : {})
		});
	const authResponse = await oauth(request, env, store);
	if (authResponse) return authResponse;
	const user = await authenticatedUser(request, env, store);
	if (url.pathname === '/api/session' && request.method === 'GET')
		return Response.json(await session(store, user));
	if (url.pathname === '/api/groups' && request.method === 'POST') {
		const data = z
			.object({ name: z.string().trim().min(1).max(100), discordChannelId: z.string().regex(/^\d{17,20}$/) })
			.parse(await request.json());
		return Response.json(
			{ group: await createGroup(store, user, env, data.name, data.discordChannelId) },
			{ status: 201 }
		);
	}
	const select = url.pathname.match(/^\/api\/groups\/([\w-]+)\/select$/);
	if (select && request.method === 'POST') {
		await store.transaction(async (tx, writes) => {
			await requireGroup(store, select[1], user.id, false, tx);
			const current = await store.get<GlobalUser>(`users/${user.id}`, tx);
			writes.push(store.write(`users/${user.id}`, { ...current, lastActiveGroupId: select[1] }));
		});
		return Response.json({ ok: true });
	}
	const state = url.pathname.match(/^\/api\/groups\/([\w-]+)\/state$/);
	if (state && request.method === 'GET') return Response.json(await loadGroup(store, state[1], user.id));
	const command = url.pathname.match(/^\/api\/groups\/([\w-]+)\/commands\/([\w-]+)$/);
	if (command && request.method === 'POST') {
		if (command[2] === 'syncDiscordMembers')
			return Response.json({
				...(await syncMembers(store, env, command[1], user)),
				result: { reference: command[1] }
			});
		return Response.json(await groupCommand(store, command[1], user.id, command[2], await request.json()));
	}
	if (url.pathname === '/api/discord/channels' && request.method === 'GET') {
		if (user.role !== 'admin')
			throw new DomainError('Chỉ quản trị viên hệ thống được xem các kênh của bot.', 403);
		return Response.json({
			channels: (await new Discord(env).channels()).map(({ id, guild_id, name, type }) => ({
				id,
				guildId: guild_id,
				name,
				type
			}))
		});
	}
	const channelMembers = url.pathname.match(/^\/api\/discord\/channels\/(\d{17,20})\/members$/);
	if (channelMembers && request.method === 'GET') {
		if (user.role !== 'admin') {
			const groupId = url.searchParams.get('groupId') ?? '';
			const { group } = await requireGroup(store, groupId, user.id, true);
			if (group.discordChannelId !== channelMembers[1]) throw new DomainError('Kênh không thuộc nhóm.', 403);
		}
		return Response.json({
			members: (await new Discord(env).members(channelMembers[1])).map((profile) => ({
				id: `discord_${profile.id}`,
				name: profile.global_name || profile.username
			}))
		});
	}
	if (url.pathname === '/api/discord/dm' && request.method === 'POST') {
		const input = bodySchema.parse(await request.json());
		await requireGroup(store, input.groupId, user.id, true);
		const recipients = [...new Set(input.recipients)];
		for (const id of recipients)
			if (!(await store.get<Member>(`groups/${input.groupId}/members/${id}`)))
				throw new DomainError('Người nhận phải là thành viên của nhóm.', 400);
		const limitKey = `dm-rate:${user.id}:${Math.floor(Date.now() / 60000)}`;
		if (!(await sessionOperation<boolean>(env, 'claim', `dm:${user.id}:${input.id}`, { ttl: 3600000 })))
			throw new DomainError('Đợt tin nhắn này đã được xử lý. Không gửi lại để tránh trùng.', 409);
		let allowed = false;
		for (let slot = 0; slot < 5; slot++) {
			if (await sessionOperation<boolean>(env, 'claim', `${limitKey}:${slot}`, { ttl: 65000 })) {
				allowed = true;
				break;
			}
		}
		if (!allowed) throw new DomainError('Chỉ gửi tối đa 5 đợt tin nhắn mỗi phút.', 429);
		const results = [];
		for (const uid of recipients) {
			try {
				results.push({ uid, ...(await new Discord(env).dm(uid.slice(8), input.message)) });
			} catch {
				results.push({ uid, status: 'failed' });
			}
		}
		const id = crypto.randomUUID();
		await store.commit([
			store.write(`groups/${input.groupId}/audit/${id}`, {
				id,
				actor: user.id,
				action: 'sendDiscordDm',
				reference: input.id,
				date: new Date().toISOString()
			})
		]);
		return Response.json({ results });
	}
	throw new DomainError('Không tìm thấy API.', 404);
}
export default {
	async fetch(request: Request, env: Env): Promise<Response> {
		let response: Response;
		const origin = request.headers.get('origin');
		try {
			assertEnvironment(env, request);
			if (origin && origin !== env.FRONTEND_ORIGIN && origin !== new URL(request.url).origin)
				throw new DomainError('Nguồn yêu cầu không được phép.', 403);
			if (Number(request.headers.get('content-length')) > 1_000_000)
				throw new DomainError('Dữ liệu quá lớn.', 413);
			response =
				request.method === 'OPTIONS' ? new Response(null, { status: 204 }) : await route(request, env);
		} catch (error) {
			const status =
				error instanceof DomainError
					? error.status
					: error instanceof ZodError || error instanceof SyntaxError
						? 400
						: 503;
			if (status === 503) console.error(error instanceof Error ? error.message : 'Worker request failed');
			response = Response.json(
				{
					message:
						error instanceof DomainError
							? error.message
							: status === 400
								? 'Thông tin gửi lên không hợp lệ.'
								: 'Chưa kết nối được dịch vụ. Kiểm tra cấu hình backend.'
				},
				{ status }
			);
		}
		const headers = new Headers(response.headers);
		headers.set('cache-control', 'no-store');
		headers.set('x-content-type-options', 'nosniff');
		headers.set(
			'referrer-policy',
			new URL(request.url).pathname === '/auth/mock' ? 'same-origin' : 'no-referrer'
		);
		if (origin === env.FRONTEND_ORIGIN) {
			headers.set('access-control-allow-origin', origin);
			headers.set('vary', 'Origin');
			headers.set('access-control-allow-headers', 'Authorization, Content-Type');
			headers.set('access-control-allow-methods', 'GET, POST, OPTIONS');
		}
		return new Response(response.body, { status: response.status, headers });
	}
};
