import { createRemoteJWKSet, decodeJwt, SignJWT } from 'jose';
import type { Env } from './env';
import { isLocal } from './env';
import { privateKey } from './store';
import { jwtVerify } from 'jose';
import { DomainError } from '../../src/lib/domain/ledger';
import type { GlobalUser } from '../../src/lib/domain/types';
import type { DataStore as Store } from './store';

const keys = createRemoteJWKSet(
	new URL('https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com')
);
export async function verifiedUserId(request: Request, env: Env): Promise<string> {
	const token = request.headers.get('authorization')?.match(/^Bearer (\S+)$/)?.[1];
	if (!token) throw new DomainError('Vui lòng đăng nhập bằng Discord.', 401);
	let uid: string;
	try {
		if (isLocal(env)) {
			// The Auth emulator validates locally issued tokens, including its unsigned emulator format.
			const lookup = await fetch(
				`http://${env.FIREBASE_AUTH_EMULATOR_HOST}/identitytoolkit.googleapis.com/v1/accounts:lookup?key=${env.FIREBASE_API_KEY}`,
				{
					method: 'POST',
					headers: { 'content-type': 'application/json' },
					body: JSON.stringify({ idToken: token })
				}
			);
			const data = (await lookup.json()) as { users?: { localId: string }[] };
			const claims = decodeJwt(token);
			if (
				!lookup.ok ||
				!data.users?.length ||
				claims.aud !== env.FIREBASE_PROJECT_ID ||
				claims.iss !== `https://securetoken.google.com/${env.FIREBASE_PROJECT_ID}` ||
				!claims.exp ||
				claims.exp <= Date.now() / 1000
			)
				throw new Error();
			uid = data.users[0].localId;
		} else {
			const { payload } = await jwtVerify(token, keys, {
				algorithms: ['RS256'],
				audience: env.FIREBASE_PROJECT_ID,
				issuer: `https://securetoken.google.com/${env.FIREBASE_PROJECT_ID}`,
				requiredClaims: ['exp', 'iat', 'auth_time', 'sub']
			});
			if (
				typeof payload.auth_time !== 'number' ||
				payload.auth_time <= 0 ||
				payload.auth_time > Date.now() / 1000 ||
				!payload.iat ||
				payload.iat > Date.now() / 1000 + 5 ||
				!payload.sub ||
				payload.sub.length > 128
			)
				throw new Error();
			uid = payload.sub;
		}
		if (!/^discord_\d{17,20}$/.test(uid)) throw new Error();
	} catch {
		throw new DomainError('Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.', 401);
	}
	return uid;
}
export async function authenticatedUser(request: Request, env: Env, store: Store): Promise<GlobalUser> {
	const uid = await verifiedUserId(request, env);
	const user = await store.get<GlobalUser>(`users/${uid}`);
	if (!user || user.discordId !== uid.slice(8))
		throw new DomainError('Không tìm thấy tài khoản Discord.', 403);
	return user;
}
export async function customToken(env: Env, uid: string): Promise<string> {
	const issuer = env.FIREBASE_CLIENT_EMAIL ?? 'mock@demo-lunchroom.iam.gserviceaccount.com';
	const jwt = new SignJWT({ uid })
		.setProtectedHeader({ alg: isLocal(env) ? 'HS256' : 'RS256' })
		.setIssuer(issuer)
		.setSubject(issuer)
		.setAudience('https://identitytoolkit.googleapis.com/google.identity.identitytoolkit.v1.IdentityToolkit')
		.setIssuedAt()
		.setExpirationTime('5m');
	return jwt.sign(
		isLocal(env) ? new TextEncoder().encode('local-emulator-custom-tokens-only') : await privateKey(env)
	);
}
export async function sessionOperation<T>(env: Env, op: string, key: string, extra: object = {}): Promise<T> {
	const object = env.AUTH_SESSIONS.get(env.AUTH_SESSIONS.idFromName('auth-and-limits'));
	const response = await object.fetch('https://sessions.internal', {
		method: 'POST',
		body: JSON.stringify({ op, key, ...extra })
	});
	return response.json() as Promise<T>;
}
export function base64url(bytes: Uint8Array) {
	return btoa(String.fromCharCode(...bytes))
		.replace(/\+/g, '-')
		.replace(/\//g, '_')
		.replace(/=+$/, '');
}
export async function challenge(verifier: string) {
	return base64url(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))));
}
export function randomCode() {
	return base64url(crypto.getRandomValues(new Uint8Array(32)));
}
