import { initializeApp, getApps } from 'firebase/app';
import { goto } from '$app/navigation';
import {
	connectAuthEmulator,
	getAuth,
	onAuthStateChanged,
	signInWithCustomToken,
	signOut,
	updateProfile,
	type Auth
} from 'firebase/auth';
import type { AppState, Group, Session } from '$lib/domain/types';

export class ApiError extends Error {
	constructor(
		message: string,
		public status: number
	) {
		super(message);
	}
}
const apiBase = () =>
	import.meta.env.VITE_WORKER_API_URL || (import.meta.env.DEV ? 'http://127.0.0.1:8787' : '');
let auth: Auth | undefined;
async function request(path: string, options: RequestInit = {}, authenticated = true) {
	const base = apiBase();
	if (!base) throw new Error('Chưa cấu hình địa chỉ Cloudflare Worker.');
	const token = authenticated ? await auth?.currentUser?.getIdToken() : undefined;
	const response = await fetch(`${base}${path}`, {
		...options,
		headers: {
			'content-type': 'application/json',
			...(token ? { authorization: `Bearer ${token}` } : {}),
			...options.headers
		}
	});
	if (!response.ok) {
		const data = await response.json().catch(() => ({}));
		throw new ApiError(data.message || 'Không xử lý được yêu cầu.', response.status);
	}
	return response;
}
export async function requestJson(path: string, options: RequestInit = {}, authenticated = true) {
	return (await request(path, options, authenticated)).json();
}
export async function initializeAuth() {
	const config = await requestJson('/config', {}, false);
	const app = getApps()[0] || initializeApp(config.firebase);
	if (!auth) {
		auth = getAuth(app);
		if (config.mode === 'local') {
			if (!['127.0.0.1', 'localhost'].includes(location.hostname))
				throw new Error('Chế độ thử nghiệm chỉ dùng trên máy cục bộ.');
			connectAuthEmulator(auth, config.authEmulatorUrl, { disableWarnings: true });
		}
		await new Promise<void>((resolve) => {
			const unsubscribe = onAuthStateChanged(auth!, () => {
				unsubscribe();
				resolve();
			});
		});
	}
	const code = new URLSearchParams(location.hash.slice(1)).get('auth_code');
	if (code) {
		await goto(location.pathname + location.search, { shallow: true, replace: true });
		const verifier = sessionStorage.getItem('discord-login-verifier');
		if (!verifier) throw new Error('Không tìm thấy phiên đăng nhập trên trình duyệt này.');
		const response = await requestJson(
			'/auth/exchange',
			{ method: 'POST', body: JSON.stringify({ code, verifier }) },
			false
		);
		sessionStorage.removeItem('discord-login-verifier');
		await signInWithCustomToken(auth, response.token);
		const returnTo = sessionStorage.getItem('discord-login-return');
		sessionStorage.removeItem('discord-login-return');
		if (returnTo?.startsWith('/') && new URL(returnTo, location.origin).origin === location.origin)
			await goto(returnTo, { replace: true });
	}
	if (auth.currentUser && !/^discord_\d{17,20}$/.test(auth.currentUser.uid)) await signOut(auth);
	return { signedIn: !!auth.currentUser, local: config.mode === 'local', uid: auth.currentUser?.uid };
}
export async function beginDiscordLogin() {
	sessionStorage.setItem('discord-login-return', location.pathname + location.search);
	const bytes = crypto.getRandomValues(new Uint8Array(32));
	const encode = (bytes: Uint8Array) =>
		btoa(String.fromCharCode(...bytes))
			.replace(/\+/g, '-')
			.replace(/\//g, '_')
			.replace(/=+$/, '');
	const verifier = encode(bytes);
	sessionStorage.setItem('discord-login-verifier', verifier);
	const challenge = encode(
		new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier)))
	);
	location.assign(`${apiBase()}/auth/discord?challenge=${challenge}`);
}
export async function logout() {
	if (auth) await signOut(auth);
}
export async function getSession(): Promise<Session> {
	const session = await requestJson('/api/session');
	if (auth?.currentUser)
		await updateProfile(auth.currentUser, {
			displayName: session.user.name,
			photoURL: session.user.avatarUrl || null
		}).catch(() => {});
	return session;
}
export async function selectGroup(id: string) {
	return requestJson(`/api/groups/${id}/select`, { method: 'POST', body: '{}' });
}
export async function saveDiscordNotificationPreference(
	enabled: boolean
): Promise<{ preferences: { discordBillNotifications: boolean } }> {
	return requestJson('/api/preferences', {
		method: 'POST',
		body: JSON.stringify({ discordBillNotifications: enabled })
	});
}
export type GroupState = { state: AppState; actor: string; group: Group };
export async function fetchState(groupId: string): Promise<GroupState>;
export async function fetchState(
	groupId: string,
	since: number | undefined
): Promise<GroupState | { unchanged: true; actor: string; group: Group }>;
export async function fetchState(groupId: string, since?: number) {
	return requestJson(`/api/groups/${groupId}/state${since === undefined ? '' : `?since=${since}`}`);
}
export async function sendCommand(
	groupId: string,
	command: string,
	data: unknown
): Promise<{ state: AppState; group?: Group; result: { reference?: string } }> {
	return requestJson(`/api/groups/${groupId}/commands/${command}`, {
		method: 'POST',
		body: JSON.stringify(data)
	});
}
export async function uploadBillImage(groupId: string, image: Blob): Promise<string> {
	const { imageId } = await requestJson(`/api/groups/${groupId}/images`, {
		method: 'POST',
		headers: { 'content-type': image.type },
		body: image
	});
	return imageId;
}
export type AiSettings = { endpoint: string; model: string; hasApiKey: boolean };
export async function fetchAiSettings(groupId: string): Promise<AiSettings> {
	return requestJson(`/api/groups/${groupId}/ai-settings`);
}
export async function scanBillImage(
	groupId: string,
	imageId: string
): Promise<import('$lib/domain/ai').BillScan> {
	return requestJson(`/api/groups/${groupId}/ai/scan`, {
		method: 'POST',
		body: JSON.stringify({ imageId })
	});
}
/** Images sit behind the API's bearer auth, so they are fetched as blobs rather than linked directly. */
export async function fetchBillImage(groupId: string, imageId: string): Promise<Blob> {
	return (await request(`/api/groups/${groupId}/images/${encodeURIComponent(imageId)}`)).blob();
}
