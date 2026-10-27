<script lang="ts">
	import { ImageOff, LoaderCircle } from '@lucide/svelte';
	import { fetchBillImage } from '$lib/client/api';
	let { groupId, imageId }: { groupId: string; imageId: string } = $props();
	let url = $state('');
	let failed = $state(false);
	$effect(() => {
		let objectUrl = '';
		let cancelled = false;
		url = '';
		failed = false;
		fetchBillImage(groupId, imageId)
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

{#if url}<a class="bill-image" href={url} target="_blank" rel="noopener noreferrer" title="Mở ảnh đầy đủ"
		><img src={url} alt="Ảnh hóa đơn" /></a
	>{:else if failed}<p class="bill-image-status" role="status">
		<ImageOff size={16} />Không tải được ảnh hóa đơn.
	</p>{:else}<p class="bill-image-status"><LoaderCircle class="spin" size={16} />Đang tải ảnh…</p>{/if}
