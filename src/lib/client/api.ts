import { initializeApp, getApps } from 'firebase/app';
import { connectAuthEmulator, getAuth, signInWithEmailAndPassword } from 'firebase/auth';
import type { AppState } from '$lib/domain/types';
let connected = false;
export class ApiError extends Error {
	constructor(
		message: string,
		public status: number
	) {
		super(message);
	}
}
function localAuth() {
	const app =
		getApps()[0] ||
		initializeApp({ apiKey: 'demo-lunchroom-key', projectId: 'demo-lunchroom', authDomain: 'localhost' });
	const auth = getAuth(app);
	if (!connected) {
		connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
		connected = true;
	}
	return auth;
}
export async function requestJson(path: string, options: RequestInit = {}) {
	const response = await fetch(path, options);
	const data = await response.json();
	if (!response.ok) throw new ApiError(data.message || 'Không thể xử lý yêu cầu.', response.status);
	return data;
}
export async function login(memberId: string) {
	const account = await requestJson('/api/demo', {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify({ memberId })
	});
	await signInWithEmailAndPassword(localAuth(), account.email, account.password);
}
async function headers() {
	const user = localAuth().currentUser;
	if (!user) throw new Error('Vui lòng chọn tài khoản.');
	return { 'content-type': 'application/json', authorization: `Bearer ${await user.getIdToken()}` };
}
export async function fetchState(): Promise<{ state: AppState; actor: string }> {
	return requestJson('/api/state', { headers: await headers() });
}
export async function sendCommand(
	command: string,
	data: unknown
): Promise<{ state: AppState; result: { reference?: string } }> {
	return requestJson(`/api/commands/${command}`, {
		method: 'POST',
		headers: await headers(),
		body: JSON.stringify(data)
	});
}
