import type { DurableObjectState } from '@cloudflare/workers-types';
export class AuthSessions {
	constructor(private state: DurableObjectState) {}
	async fetch(request: Request) {
		const data = (await request.json()) as {
			op: 'put' | 'get' | 'take' | 'claim';
			key: string;
			value?: unknown;
			ttl?: number;
			challenge?: string;
		};
		const result = await this.state.storage.transaction(async (tx) => {
			const existing = await tx.get<{ value: any; expiresAt: number }>(data.key);
			if (data.op === 'get') return existing && existing.expiresAt > Date.now() ? existing.value : null;
			if (data.op === 'put') {
				await tx.put(data.key, {
					value: data.value,
					expiresAt: Date.now() + Math.min(data.ttl ?? 60000, 3600000)
				});
				return true;
			}
			if (data.op === 'claim') {
				if (existing && existing.expiresAt > Date.now()) return false;
				await tx.put(data.key, { value: true, expiresAt: Date.now() + (data.ttl ?? 60000) });
				return true;
			}
			if (
				!existing ||
				existing.expiresAt < Date.now() ||
				(data.challenge && existing.value.challenge !== data.challenge)
			)
				return null;
			await tx.delete(data.key);
			return existing.value;
		});
		if ((await this.state.storage.getAlarm()) === null)
			await this.state.storage.setAlarm(Date.now() + 3600000);
		return Response.json(result);
	}
	async alarm() {
		let remaining = false;
		for (const [key, record] of await this.state.storage.list<{ expiresAt: number }>())
			if (record.expiresAt < Date.now()) await this.state.storage.delete(key);
			else remaining = true;
		if (remaining) await this.state.storage.setAlarm(Date.now() + 3600000);
	}
}
