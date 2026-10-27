import { describe, expect, it, vi } from 'vitest';
import { applyCommand } from '../../src/lib/domain/ledger';
import { createDemoState } from '../../src/lib/domain/seed';
import { detectImage, requireUploadedImage, uploadBillImage } from '../../worker/src/images';
import { Discord } from '../../worker/src/discord';
import type { Env } from '../../worker/src/env';
import type { Store } from '../../worker/src/store';

const now = '2026-10-27T05:00:00.000Z';
const imageId = '3f2504e0-4f89-41d3-9a0c-0305e82c3301.webp';
const uploader = 'discord_100000000000000001';
const bill = (image?: unknown) => ({
	id: 'lunch',
	description: 'Cơm trưa',
	date: now,
	discordNotification: false,
	lines: [
		{ memberId: 'linh', amount: 30000, description: '', note: '' },
		{ memberId: 'huy', amount: 40000, description: '', note: '' }
	],
	...(image === undefined ? {} : { image })
});
const ascii = (text: string) => [...text].map((character) => character.charCodeAt(0));
const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0x10]);
const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0]);
const webp = new Uint8Array([...ascii('RIFF'), 0, 0, 0, 0, ...ascii('WEBPVP8 ')]);

type Stored = { bytes: Uint8Array; uploadedBy: string; type: string };
type PutOptions = { httpMetadata: { contentType: string }; customMetadata: { uploadedBy: string } };
function bucket() {
	const objects = new Map<string, Stored>();
	return {
		objects,
		put: vi.fn(async (key: string, bytes: Uint8Array, options: PutOptions) => {
			objects.set(key, {
				bytes,
				uploadedBy: options.customMetadata.uploadedBy,
				type: options.httpMetadata.contentType
			});
		}),
		head: vi.fn(async (key: string) => {
			const object = objects.get(key);
			return object ? { customMetadata: { uploadedBy: object.uploadedBy } } : null;
		})
	};
}
const memberStore = () =>
	({
		get: vi.fn(async (path: string) =>
			path.includes('/members/') ? { id: uploader, active: true, role: 'member' } : { id: 'group' }
		)
	}) as unknown as Store;
const upload = (body: Uint8Array<ArrayBuffer>, type = 'image/webp') =>
	new Request('https://worker.example/api/groups/group/images', {
		method: 'POST',
		headers: { 'content-type': type, 'content-length': String(body.byteLength) },
		body: new Blob([body])
	});

describe('bill images in the ledger', () => {
	it('stores an uploaded image id on the bill', () => {
		const state = createDemoState(new Date(now));
		applyCommand(state, 'linh', 'createBill', bill(imageId), now);
		expect(state.bills.find((entry) => entry.id === 'lunch')?.image).toBe(imageId);
	});
	it('keeps bills without an image unchanged', () => {
		const state = createDemoState(new Date(now));
		applyCommand(state, 'linh', 'createBill', bill(), now);
		expect(state.bills.find((entry) => entry.id === 'lunch')).not.toHaveProperty('image');
	});
	it.each(['../other-group/x.webp', 'image.gif', `${imageId}.exe`, 42])(
		'rejects the image reference %s',
		(image) => {
			const state = createDemoState(new Date(now));
			expect(() => applyCommand(state, 'linh', 'createBill', bill(image), now)).toThrow();
			expect(state.bills.some((entry) => entry.id === 'lunch')).toBe(false);
		}
	);
});

describe('bill image storage', () => {
	it('recognises JPEG, PNG and WebP by their bytes, not their declared type', () => {
		expect(detectImage(jpeg)).toMatchObject({ ext: 'jpg', type: 'image/jpeg' });
		expect(detectImage(png)).toMatchObject({ ext: 'png', type: 'image/png' });
		expect(detectImage(webp)).toMatchObject({ ext: 'webp', type: 'image/webp' });
		expect(detectImage(new TextEncoder().encode('<svg onload="x">'))).toBeNull();
	});
	it('stores uploads under the group with the uploader recorded', async () => {
		const images = bucket();
		const env = { BILL_IMAGES: images } as unknown as Env;
		const { imageId: stored } = await uploadBillImage(memberStore(), env, 'group', uploader, upload(png));
		expect(stored).toMatch(/^[0-9a-f-]{36}\.png$/);
		expect(images.objects.get(`groups/group/bills/${stored}`)).toMatchObject({
			uploadedBy: uploader,
			type: 'image/png'
		});
	});
	it('rejects files that are not images', async () => {
		const env = { BILL_IMAGES: bucket() } as unknown as Env;
		await expect(
			uploadBillImage(memberStore(), env, 'group', uploader, upload(new TextEncoder().encode('<html>')))
		).rejects.toMatchObject({ status: 415 });
	});
	it('only lets the uploader attach an image to a bill in the same group', async () => {
		const env = { BILL_IMAGES: bucket() } as unknown as Env;
		const { imageId: stored } = await uploadBillImage(memberStore(), env, 'group', uploader, upload(jpeg));
		await expect(requireUploadedImage(env, 'group', uploader, stored)).resolves.toBeUndefined();
		await expect(
			requireUploadedImage(env, 'group', 'discord_100000000000000002', stored)
		).rejects.toMatchObject({ status: 400 });
		await expect(requireUploadedImage(env, 'other', uploader, stored)).rejects.toMatchObject({
			status: 400
		});
	});
});

describe('Discord DM attachments', () => {
	it('sends the bill image as a multipart attachment alongside the message', async () => {
		const discord = new Discord({ APP_ENV: 'production' } as Env);
		const api = vi.spyOn(discord, 'api').mockResolvedValueOnce({ id: 'channel' }).mockResolvedValueOnce({});
		await discord.dm('100000000000000002', 'Hóa đơn', 'nonce', {
			name: 'hoa-don.webp',
			data: new Blob([webp], { type: 'image/webp' })
		});
		const [path, init] = api.mock.calls[1] as [string, RequestInit];
		expect(path).toBe('/channels/channel/messages');
		const form = init.body as FormData;
		expect(form).toBeInstanceOf(FormData);
		expect(JSON.parse(form.get('payload_json') as string)).toMatchObject({
			content: 'Hóa đơn',
			nonce: 'nonce',
			attachments: [{ id: 0, filename: 'hoa-don.webp' }]
		});
		expect((form.get('files[0]') as File).name).toBe('hoa-don.webp');
	});
	it('keeps text-only DMs as JSON', async () => {
		const discord = new Discord({ APP_ENV: 'production' } as Env);
		const api = vi.spyOn(discord, 'api').mockResolvedValueOnce({ id: 'channel' }).mockResolvedValueOnce({});
		await discord.dm('100000000000000002', 'Hóa đơn');
		expect(typeof (api.mock.calls[1][1] as RequestInit).body).toBe('string');
	});
	it('preserves rich embeds and their private attachment references in multipart messages', async () => {
		const discord = new Discord({ APP_ENV: 'production' } as Env);
		const api = vi.spyOn(discord, 'api').mockResolvedValueOnce({ id: 'channel' }).mockResolvedValueOnce({});
		const message = {
			embeds: [{ title: 'Nhóm: Ăn trưa', color: 0x315e47, image: { url: 'attachment://hoa-don.webp' } }]
		};
		await discord.dm('100000000000000002', message, 'nonce', {
			name: 'hoa-don.webp',
			data: new Blob([webp], { type: 'image/webp' })
		});
		const form = (api.mock.calls[1][1] as RequestInit).body as FormData;
		expect(JSON.parse(form.get('payload_json') as string)).toMatchObject({
			embeds: message.embeds,
			nonce: 'nonce',
			allowed_mentions: { parse: [] }
		});
		expect(JSON.parse(form.get('payload_json') as string)).not.toHaveProperty('content');
	});
});
