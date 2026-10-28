import { z } from 'zod';
import {
	BILL_SCAN_PROMPT,
	BILL_SCAN_SCHEMA,
	chatCompletionsUrl,
	parseBillScan,
	type BillScan
} from '../../src/lib/domain/ai';
import { DomainError } from '../../src/lib/domain/ledger';
import type { Group } from '../../src/lib/domain/types';
import { isLocal, type Env } from './env';
import { requireGroup } from './groups';
import { sessionOperation } from './identity';
import { billImageAttachment, requireUploadedImage } from './images';
import type { DataStore as Store } from './store';

/** Kept outside the group document so the key never reaches clients with group state. */
type AiSettings = { endpoint: string; model: string; apiKey: string; updatedBy: string; updatedAt: string };
const settingsPath = (groupId: string) => `groupAiSettings/${groupId}`;
const SCAN_COOLDOWN_MS = 5000;
const SCAN_TIMEOUT_MS = 45000;

const settingsInput = z
	.object({
		endpoint: z.string().trim().max(300),
		model: z.string().trim().max(100),
		apiKey: z.string().trim().max(500).optional(),
		clearApiKey: z.boolean().optional()
	})
	.strict();

function requireSafeEndpoint(env: Env, endpoint: string) {
	let url: URL;
	try {
		url = new URL(endpoint);
	} catch {
		throw new DomainError('Endpoint AI không phải URL hợp lệ.', 400);
	}
	const allowed = isLocal(env) ? ['https:', 'http:'] : ['https:'];
	if (!allowed.includes(url.protocol) || url.username || url.password)
		throw new DomainError('Endpoint AI phải dùng HTTPS và không chứa thông tin đăng nhập.', 400);
}

export async function readAiSettings(store: Store, groupId: string, uid: string) {
	await requireGroup(store, groupId, uid, true);
	const settings = await store.get<AiSettings>(settingsPath(groupId));
	return { endpoint: settings?.endpoint ?? '', model: settings?.model ?? '', hasApiKey: !!settings?.apiKey };
}

/** A blank key keeps the saved one; AI is enabled only while endpoint, key and model are all set. */
export async function saveAiSettings(
	store: Store,
	env: Env,
	groupId: string,
	uid: string,
	input: unknown
): Promise<Group> {
	const data = settingsInput.parse(input);
	if (data.endpoint) requireSafeEndpoint(env, data.endpoint);
	return store.transaction(async (tx, writes) => {
		const { group } = await requireGroup(store, groupId, uid, true, tx);
		const existing = await store.get<AiSettings>(settingsPath(groupId), tx);
		const apiKey = data.clearApiKey ? '' : data.apiKey || existing?.apiKey || '';
		const aiEnabled = !!(data.endpoint && data.model && apiKey);
		if (data.endpoint || data.model || apiKey)
			writes.push(
				store.write(settingsPath(groupId), {
					endpoint: data.endpoint,
					model: data.model,
					apiKey,
					updatedBy: uid,
					updatedAt: new Date().toISOString()
				})
			);
		else writes.push(store.delete(settingsPath(groupId)));
		const updated = { ...group, aiEnabled, version: group.version + 1 };
		const id = crypto.randomUUID();
		writes.push(
			store.write(`groups/${groupId}`, updated),
			store.write(`groups/${groupId}/audit/${id}`, {
				id,
				actor: uid,
				action: 'saveAiSettings',
				reference: groupId,
				date: new Date().toISOString()
			})
		);
		return updated;
	});
}

function base64(bytes: Uint8Array) {
	let binary = '';
	for (let offset = 0; offset < bytes.length; offset += 0x8000)
		binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
	return btoa(binary);
}

async function requestCompletion(settings: AiSettings, imageUrl: string) {
	try {
		return await fetch(chatCompletionsUrl(settings.endpoint), {
			method: 'POST',
			signal: AbortSignal.timeout(SCAN_TIMEOUT_MS),
			headers: { 'content-type': 'application/json', authorization: `Bearer ${settings.apiKey}` },
			body: JSON.stringify({
				model: settings.model,
				messages: [
					{ role: 'system', content: BILL_SCAN_PROMPT },
					{
						role: 'user',
						content: [
							{ type: 'text', text: 'Đọc hóa đơn trong ảnh này.' },
							{ type: 'image_url', image_url: { url: imageUrl } }
						]
					}
				],
				response_format: {
					type: 'json_schema',
					json_schema: { name: 'bill_scan', strict: true, schema: BILL_SCAN_SCHEMA }
				}
			})
		});
	} catch (error) {
		if (error instanceof DOMException && error.name === 'TimeoutError')
			throw new DomainError('Dịch vụ AI phản hồi quá lâu. Vui lòng thử lại.', 504);
		throw new DomainError('Không kết nối được dịch vụ AI. Kiểm tra endpoint.', 502);
	}
}

/** Provider error bodies can echo the key, so only the status is ever logged or surfaced. */
function providerError(status: number) {
	console.error('AI provider request failed', { status });
	if (status === 401 || status === 403)
		return new DomainError('API key AI không hợp lệ hoặc không có quyền dùng model này.', 502);
	if (status === 429) return new DomainError('Dịch vụ AI đang giới hạn yêu cầu. Thử lại sau ít phút.', 429);
	if (status === 404) return new DomainError('Không tìm thấy endpoint hoặc model AI. Kiểm tra cài đặt.', 502);
	return new DomainError('Dịch vụ AI không xử lý được ảnh này.', 502);
}

export async function scanBill(
	store: Store,
	env: Env,
	groupId: string,
	uid: string,
	imageId: string
): Promise<BillScan> {
	const { group } = await requireGroup(store, groupId, uid);
	const settings = await store.get<AiSettings>(settingsPath(groupId));
	if (!group.aiEnabled || !settings?.endpoint || !settings.model || !settings.apiKey)
		throw new DomainError('Nhóm chưa cấu hình đọc hóa đơn bằng AI.', 400);
	await requireUploadedImage(env, groupId, uid, imageId);
	// Each scan spends the group's API credit, so one person cannot fire them back to back.
	if (
		env.AUTH_SESSIONS &&
		!(await sessionOperation<boolean>(env, 'claim', `ai-scan:${uid}`, { ttl: SCAN_COOLDOWN_MS }))
	)
		throw new DomainError('Vui lòng đợi vài giây trước khi quét hóa đơn tiếp.', 429);
	const image = await billImageAttachment(env, groupId, imageId);
	if (!image) throw new DomainError('Không tìm thấy ảnh hóa đơn.', 404);
	const imageUrl = `data:${image.data.type};base64,${base64(new Uint8Array(await image.data.arrayBuffer()))}`;
	const response = await requestCompletion(settings, imageUrl);
	if (!response.ok) throw providerError(response.status);
	const body = (await response.json().catch(() => null)) as {
		choices?: { message?: { content?: unknown } }[];
	} | null;
	const content = body?.choices?.[0]?.message?.content;
	if (typeof content !== 'string') throw new DomainError('AI không đọc được hóa đơn trong ảnh.', 502);
	try {
		return parseBillScan(content);
	} catch {
		throw new DomainError('AI trả về kết quả không hợp lệ. Hãy thử ảnh rõ hơn.', 502);
	}
}
