<script lang="ts">
	import { ImageOff, LoaderCircle } from '@lucide/svelte';
	import * as Dialog from '$lib/components/ui/dialog';
	import { fetchBillImage } from '$lib/client/api';
	let { groupId, imageId }: { groupId: string; imageId: string } = $props();
	// Polling replaces bill objects; primitive derived values keep an unchanged image loaded.
	const imageGroupId = $derived(groupId);
	const receiptImageId = $derived(imageId);
	let url = $state('');
	let failed = $state(false);
	let open = $state(false);
	let zoomed = $state(false);
	$effect(() => {
		let objectUrl = '';
		let cancelled = false;
		url = '';
		failed = false;
		open = false;
		fetchBillImage(imageGroupId, receiptImageId)
			.then((blob) => {
				if (cancelled) return;
				objectUrl = URL.createObjectURL(blob);
				url = objectUrl;
			})
			.catch(() => {
				if (!cancelled) failed = true;
			});
		return () => {
			cancelled = true;
			if (objectUrl) URL.revokeObjectURL(objectUrl);
		};
	});
</script>

{#if url}<button
		class="bill-image"
		type="button"
		aria-label="Xem ảnh hóa đơn toàn màn hình"
		onclick={() => {
			zoomed = false;
			open = true;
		}}><img src={url} alt="Ảnh hóa đơn" /></button
	>
	<Dialog.Root bind:open>
		<Dialog.Content class="bill-image-lightbox" fullscreen>
			<Dialog.Title class="sr-only">Ảnh hóa đơn toàn màn hình</Dialog.Title>
			<Dialog.Description class="sr-only"
				>Nhấn vào ảnh để phóng to hoặc thu nhỏ. Nhấn Escape để đóng.</Dialog.Description
			>
			<div class="bill-image-viewport">
				<button
					type="button"
					class="bill-image-zoom"
					class:zoomed
					aria-label={zoomed ? 'Thu nhỏ ảnh hóa đơn' : 'Phóng to ảnh hóa đơn'}
					aria-pressed={zoomed}
					onclick={() => (zoomed = !zoomed)}
				>
					<img src={url} alt="Ảnh hóa đơn đầy đủ" />
				</button>
			</div>
		</Dialog.Content>
	</Dialog.Root>
{:else if failed}<p class="bill-image-status" role="status">
		<ImageOff size={16} />Không tải được ảnh hóa đơn.
	</p>{:else}<p class="bill-image-status"><LoaderCircle class="spin" size={16} />Đang tải ảnh…</p>{/if}
