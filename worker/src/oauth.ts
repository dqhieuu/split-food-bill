import type { Env } from './env';
import { isLocal } from './env';
import type { DataStore as Store } from './store';
import { challenge, customToken, randomCode, sessionOperation } from './identity';
import { mockProfiles, type DiscordProfile } from './discord';
import { profileUser, userId } from './groups';
import type { GlobalUser, Member } from '../../src/lib/domain/types';
import { DomainError } from '../../src/lib/domain/ledger';

type Flow = { challenge: string };
const cookieName = (env: Env) => (isLocal(env) ? 'discord_oauth_state' : '__Host-discord_oauth_state');
const cookie = (env: Env, state: string, age = 600) =>
	`${cookieName(env)}=${state}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${age}${isLocal(env) ? '' : '; Secure'}`;
function validState(request: Request, env: Env, state: string) {
	const saved = request.headers
		.get('cookie')
		?.split(';')
		.map((part) => part.trim())
		.find((part) => part.startsWith(`${cookieName(env)}=`))
		?.split('=')[1];
	if (!state || saved !== state)
		throw new DomainError('Phiên đăng nhập không hợp lệ. Vui lòng thử lại.', 400);
}
async function localProfiles(store: Store): Promise<DiscordProfile[]> {
	const group = await store.get<{ localSnapshot?: boolean }>('groups/local');
	if (!group?.localSnapshot) return mockProfiles;
	const members = await store.list<Member>('groups/local/members');
	return members
		.filter((member) => member.active && /^discord_\d{17,20}$/.test(member.id))
		.sort(
			(a, b) => Number(b.role === 'admin') - Number(a.role === 'admin') || a.name.localeCompare(b.name, 'vi')
		)
		.map((member) => ({ id: member.id.slice(8), username: member.name, global_name: member.name }));
}
async function finish(profile: DiscordProfile, flow: Flow, env: Env, store: Store) {
	if (!/^\d{17,20}$/.test(profile.id) || profile.bot)
		throw new DomainError('Tài khoản Discord không hợp lệ.', 400);
	const uid = userId(profile.id);
	await store.transaction(async (tx, writes) => {
		const existing = await store.get<GlobalUser>(`users/${uid}`, tx);
		writes.push(store.write(`users/${uid}`, profileUser(profile, existing, env)));
	});
	const code = randomCode();
	await sessionOperation(env, 'put', `handoff:${code}`, {
		ttl: 60000,
		value: { uid, challenge: flow.challenge }
	});
	return new Response(null, {
		status: 302,
		headers: {
			location: `${env.FRONTEND_ORIGIN}/#auth_code=${code}`,
			'set-cookie': cookie(env, '', 0),
			'cache-control': 'no-store',
			'referrer-policy': 'no-referrer'
		}
	});
}
export async function oauth(request: Request, env: Env, store: Store): Promise<Response | null> {
	const url = new URL(request.url);
	if (url.pathname === '/auth/discord' && request.method === 'GET') {
		const proof = url.searchParams.get('challenge') ?? '';
		if (!/^[A-Za-z0-9_-]{43}$/.test(proof)) throw new DomainError('Thiếu mã bảo vệ đăng nhập.', 400);
		const state = randomCode();
		await sessionOperation(env, 'put', `oauth:${state}`, { ttl: 600000, value: { challenge: proof } });
		const target = isLocal(env)
			? new URL('/auth/mock', url.origin)
			: new URL('https://discord.com/oauth2/authorize');
		target.searchParams.set('state', state);
		if (!isLocal(env)) {
			target.searchParams.set('client_id', env.DISCORD_CLIENT_ID!);
			target.searchParams.set('response_type', 'code');
			target.searchParams.set('scope', 'identify email');
			target.searchParams.set('redirect_uri', `${url.origin}/auth/callback`);
		}
		return new Response(null, {
			status: 302,
			headers: { location: target.toString(), 'set-cookie': cookie(env, state), 'cache-control': 'no-store' }
		});
	}
	if (url.pathname === '/auth/mock' && isLocal(env)) {
		const state = url.searchParams.get('state') ?? '';
		validState(request, env, state);
		const profiles = await localProfiles(store);
		if (request.method === 'GET') {
			const buttons = profiles.map((profile) => {
				const name = (profile.global_name || profile.username)
					.replaceAll('&', '&amp;')
					.replaceAll('<', '&lt;')
					.replaceAll('>', '&gt;');
				return `<p><button name="discordId" value="${profile.id}" style="padding:12px;width:100%">${name}</button></p>`;
			});
			const content = `<!doctype html><html lang="vi"><meta charset="utf-8"><title>Discord thử nghiệm</title><body style="font-family:system-ui;max-width:500px;margin:60px auto;padding:20px"><h1>Discord thử nghiệm</h1><p>Chọn tài khoản Discord giả lập cục bộ.</p><form method="post">${buttons.join('')}</form></body></html>`;
			return new Response(content, {
				headers: {
					'content-type': 'text/html;charset=utf-8',
					'cache-control': 'no-store',
					'content-security-policy': `default-src 'none'; style-src 'unsafe-inline'; form-action 'self' ${env.FRONTEND_ORIGIN}; frame-ancestors 'none'`
				}
			});
		}
		if (request.method !== 'POST') throw new DomainError('Phương thức không hợp lệ.', 405);
		const id = (await request.formData()).get('discordId');
		const profile = profiles.find((profile) => profile.id === id);
		if (!profile) throw new DomainError('Tài khoản thử nghiệm không hợp lệ.', 400);
		const flow = await sessionOperation<Flow | null>(env, 'take', `oauth:${state}`);
		if (!flow) throw new DomainError('Phiên đăng nhập đã được sử dụng hoặc hết hạn.', 400);
		return finish(profile, flow, env, store);
	}
	if (url.pathname === '/auth/callback' && request.method === 'GET') {
		if (isLocal(env)) throw new DomainError('Môi trường cục bộ dùng đăng nhập Discord giả lập.', 400);
		const state = url.searchParams.get('state') ?? '';
		validState(request, env, state);
		const flow = await sessionOperation<Flow | null>(env, 'take', `oauth:${state}`);
		if (!flow || url.searchParams.has('error') || !url.searchParams.get('code'))
			throw new DomainError('Discord chưa cấp quyền đăng nhập. Vui lòng thử lại.', 400);
		const response = await fetch('https://discord.com/api/v10/oauth2/token', {
			method: 'POST',
			body: new URLSearchParams({
				client_id: env.DISCORD_CLIENT_ID!,
				client_secret: env.DISCORD_CLIENT_SECRET!,
				grant_type: 'authorization_code',
				code: url.searchParams.get('code')!,
				redirect_uri: `${url.origin}/auth/callback`
			})
		});
		const token = (await response.json()) as { access_token?: string };
		if (!response.ok || !token.access_token)
			throw new DomainError('Không hoàn tất được đăng nhập Discord.', 401);
		const identity = await fetch('https://discord.com/api/v10/users/@me', {
			headers: { authorization: `Bearer ${token.access_token}` }
		});
		if (!identity.ok) throw new DomainError('Không đọc được danh tính Discord.', 401);
		return finish((await identity.json()) as DiscordProfile, flow, env, store);
	}
	if (url.pathname === '/auth/exchange' && request.method === 'POST') {
		const { code, verifier } = (await request.json()) as { code: string; verifier: string };
		if (!/^[A-Za-z0-9_-]{43}$/.test(code ?? '') || !/^[A-Za-z0-9_-]{43,128}$/.test(verifier ?? ''))
			throw new DomainError('Mã đăng nhập không hợp lệ.', 400);
		const handoff = await sessionOperation<{ uid: string } | null>(env, 'take', `handoff:${code}`, {
			challenge: await challenge(verifier)
		});
		if (!handoff) throw new DomainError('Mã đăng nhập đã được sử dụng hoặc hết hạn.', 401);
		return Response.json({ token: await customToken(env, handoff.uid) });
	}
	return null;
}
