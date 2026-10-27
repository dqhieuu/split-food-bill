import { BILL_IMAGE_ID, DomainError } from '../../src/lib/domain/ledger';
import type { Env } from './env';
import { requireGroup } from './groups';
import type { Store } from './store';

/** Clients downscale photos before upload, so 2 MB leaves ample room for a readable receipt. */
export const MAX_BILL_IMAGE_BYTES = 2_000_000;
type ImageKind = { ext: 'jpg' | 'png' | 'webp'; type: string };
const ascii = (bytes: Uint8Array, start: number, end: number) =>
	String.fromCharCode(...bytes.subarray(start, end));
const signatures: (ImageKind & { matches: (bytes: Uint8Array) => boolean })[] = [
	{ ext: 'jpg', type: 'image/jpeg', matches: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
	{
		ext: 'png',
		type: 'image/png',
		matches: (b) => [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every((value, i) => b[i] === value)
	},
	{ ext: 'webp', type: 'image/webp', matches: (b) => ascii(b, 0, 4) === 'RIFF' && ascii(b, 8, 12) === 'WEBP' }
];
/** The stored type comes from the file signature so a renamed HTML or SVG file is never served. */
export function detectImage(bytes: Uint8Array): ImageKind | null {
	const kind = signatures.find((signature) => signature.matches(bytes));
	return kind ? { ext: kind.ext, type: kind.type } : null;
}
const imageKey = (groupId: string, imageId: string) => `groups/${groupId}/bills/${imageId}`;
function bucket(env: Env) {
	if (!env.BILL_IMAGES) throw new DomainError('Chưa cấu hình lưu trữ ảnh hóa đơn.', 503);
	return env.BILL_IMAGES;
}
function requireImageId(imageId: string) {
	if (!BILL_IMAGE_ID.test(imageId)) throw new DomainError('Ảnh hóa đơn không hợp lệ.', 400);
}

export async function uploadBillImage(
	store: Store,
	env: Env,
	groupId: string,
	uid: string,
	request: Request
): Promise<{ imageId: string }> {
	await requireGroup(store, groupId, uid);
	if (Number(request.headers.get('content-length') ?? Infinity) > MAX_BILL_IMAGE_BYTES)
		throw new DomainError('Ảnh hóa đơn tối đa 2 MB.', 413);
	const bytes = new Uint8Array(await request.arrayBuffer());
	if (!bytes.byteLength) throw new DomainError('Chưa chọn ảnh hóa đơn.', 400);
	if (bytes.byteLength > MAX_BILL_IMAGE_BYTES) throw new DomainError('Ảnh hóa đơn tối đa 2 MB.', 413);
	const image = detectImage(bytes);
	if (!image) throw new DomainError('Chỉ hỗ trợ ảnh JPEG, PNG hoặc WebP.', 415);
	const imageId = `${crypto.randomUUID()}.${image.ext}`;
	await bucket(env).put(imageKey(groupId, imageId), bytes, {
		httpMetadata: { contentType: image.type },
		customMetadata: { uploadedBy: uid }
	});
	return { imageId };
}

/** A bill may only reference a photo its organizer uploaded to the same group. */
export async function requireUploadedImage(env: Env, groupId: string, uid: string, imageId: string) {
	requireImageId(imageId);
	const object = await bucket(env).head(imageKey(groupId, imageId));
	if (object?.customMetadata?.uploadedBy !== uid)
		throw new DomainError('Ảnh hóa đơn không hợp lệ. Hãy tải ảnh lên lại.', 400);
}

export async function readBillImage(
	store: Store,
	env: Env,
	groupId: string,
	uid: string,
	imageId: string
): Promise<Response> {
	requireImageId(imageId);
	await requireGroup(store, groupId, uid);
	const object = await bucket(env).get(imageKey(groupId, imageId));
	if (!object) throw new DomainError('Không tìm thấy ảnh hóa đơn.', 404);
	return new Response(object.body as unknown as ReadableStream, {
		headers: {
			'content-type': object.httpMetadata?.contentType ?? 'application/octet-stream',
			'content-security-policy': "default-src 'none'"
		}
	});
}

/** Loads a bill photo for a Discord attachment; returns null when it is missing. */
export async function billImageAttachment(env: Env, groupId: string, imageId: string) {
	requireImageId(imageId);
	const object = await bucket(env).get(imageKey(groupId, imageId));
	if (!object) return null;
	const type = object.httpMetadata?.contentType ?? 'application/octet-stream';
	return {
		name: `hoa-don.${imageId.split('.').pop()}`,
		data: new Blob([await object.arrayBuffer()], { type })
	};
}
