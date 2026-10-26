import { z, ZodError } from 'zod';
import type { Env } from './env';
import { assertEnvironment, isLocal } from './env';
import { Store } from './store';
import { authenticatedUser } from './identity';
import { oauth } from './oauth';
import { createGroup, groupCommand, loadGroup, requireGroup, session, syncMembers } from './groups';
import { Discord } from './discord';
import { DomainError } from '../../src/lib/domain/ledger';
import type { GlobalUser } from '../../src/lib/domain/types';
import { deliverBillNotifications } from './notifications';
export { AuthSessions } from './sessions';

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
			.object({ name: z.string().trim().min(1).max(100), discordGuildId: z.string().regex(/^\d{17,20}$/) })
			.parse(await request.json());
		return Response.json(
			{ group: await createGroup(store, user, env, data.name, data.discordGuildId) },
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
		if (command[2] === 'retryBillNotification') {
			const { id } = z.object({ id: z.string().regex(/^[\w.-]{1,100}$/) }).parse(await request.json());
			await deliverBillNotifications(store, env, command[1], user.id, id, true);
			return Response.json({ ...(await loadGroup(store, command[1], user.id)), result: { reference: id } });
		}
		if (command[2] === 'syncDiscordMembers')
			return Response.json({
				...(await syncMembers(store, env, command[1], user)),
				result: { reference: command[1] }
			});
		const outcome = await groupCommand(store, command[1], user.id, command[2], await request.json());
		if (command[2] === 'createBill' && outcome.result.reference) {
			try {
				await deliverBillNotifications(store, env, command[1], user.id, outcome.result.reference);
			} catch {
				console.error('Bill saved; Discord notification delivery did not complete.');
			}
			return Response.json({ ...(await loadGroup(store, command[1], user.id)), result: outcome.result });
		}
		return Response.json(outcome);
	}
	if (url.pathname === '/api/discord/guilds' && request.method === 'GET') {
		if (user.role !== 'admin')
			throw new DomainError('Chỉ quản trị viên hệ thống được xem các máy chủ của bot.', 403);
		return Response.json({
			guilds: (await new Discord(env).guilds()).map(({ id, name, icon }) => ({ id, name, icon }))
		});
	}
	const guildMembers = url.pathname.match(/^\/api\/discord\/guilds\/(\d{17,20})\/members$/);
	if (guildMembers && request.method === 'GET') {
		if (user.role !== 'admin') {
			const groupId = url.searchParams.get('groupId') ?? '';
			const { group } = await requireGroup(store, groupId, user.id, true);
			if (group.discordGuildId !== guildMembers[1]) throw new DomainError('Máy chủ không thuộc nhóm.', 403);
		}
		return Response.json({
			members: (await new Discord(env).members(guildMembers[1])).map((profile) => ({
				id: `discord_${profile.id}`,
				name: profile.global_name || profile.username
			}))
		});
	}
	if (url.pathname === '/api/discord/dm' && request.method === 'POST') {
		const input = z
			.object({ groupId: z.string().regex(/^[\w-]{1,100}$/), billId: z.string().regex(/^[\w.-]{1,100}$/) })
			.strict()
			.parse(await request.json());
		await deliverBillNotifications(store, env, input.groupId, user.id, input.billId, true);
		return Response.json(await loadGroup(store, input.groupId, user.id));
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
