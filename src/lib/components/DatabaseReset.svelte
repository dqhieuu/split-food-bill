<script lang="ts">
	import { untrack } from 'svelte';
	import { LoaderCircle, Trash } from '@lucide/svelte';
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import { ApiError, requestJson } from '$lib/client/api';
	import Modal from './Modal.svelte';
	let {
		open = $bindable(false),
		actor,
		onComplete
	}: { open: boolean; actor: string; onComplete: () => Promise<void> } = $props();
	let confirmation = $state('');
	let busy = $state(false);
	let error = $state('');
	let progress = $state(0);
	let pendingId = $state('');
	let checkedActor = '';
	const storageKey = (id: string) => `database-reset:${id}`;
	$effect(() => {
		const id = actor;
		untrack(() => {
			if (!id || checkedActor === id) return;
			checkedActor = id;
			const pending = localStorage.getItem(storageKey(id));
			if (pending) {
				pendingId = pending;
				open = true;
				void execute(false);
			}
		});
	});
	async function execute(start: boolean) {
		if (busy) return;
		busy = true;
		error = '';
		const owner = actor;
		const id = pendingId || crypto.randomUUID();
		try {
			pendingId = id;
			localStorage.setItem(storageKey(owner), id);
			let state = await requestJson('/api/admin/database-reset', {
				method: 'POST',
				body: JSON.stringify({ id, action: start ? 'start' : 'continue', ...(start ? { confirmation } : {}) })
			});
			while (state.status !== 'complete') {
				progress = state.processedDocuments;
				state = await requestJson('/api/admin/database-reset', {
					method: 'POST',
					body: JSON.stringify({ id, action: 'continue' })
				});
			}
			localStorage.removeItem(storageKey(owner));
			pendingId = '';
			confirmation = '';
			progress = 0;
			open = false;
			await onComplete();
		} catch (cause) {
			error = (cause as Error).message;
			if (
				cause instanceof ApiError &&
				([400, 403, 404].includes(cause.status) || (start && cause.status === 409))
			) {
				localStorage.removeItem(storageKey(owner));
				pendingId = '';
			}
		} finally {
			busy = false;
		}
	}
</script>

<Modal
	bind:open
	title="Xóa toàn bộ cơ sở dữ liệu"
	description="Xóa tất cả nhóm, hồ sơ người dùng, hóa đơn, giao dịch và dữ liệu lưu trữ. Bạn sẽ được đăng xuất khi hoàn tất."
	locked={busy}
>
	{#if busy}
		<p class="reset-progress" role="status">
			<LoaderCircle class="spin" size={20} />Đang xóa · Đã xử lý {progress} bản ghi
		</p>
	{:else}
		{#if !pendingId}<label class="field"
				>Nhập XÓA TOÀN BỘ để xác nhận<Input
					aria-label="Xác nhận xóa cơ sở dữ liệu"
					bind:value={confirmation}
					autocomplete="off"
				/></label
			>{/if}
		{#if error}<p class="validation-error" role="alert">{error}</p>{/if}
		<div class="button-row">
			<Button variant="outline" onclick={() => (open = false)}>Đóng</Button>
			<Button
				variant="destructive"
				disabled={!pendingId && confirmation !== 'XÓA TOÀN BỘ'}
				onclick={() => execute(!pendingId)}
				><Trash size={16} />{pendingId ? 'Tiếp tục xóa' : 'Xóa toàn bộ dữ liệu'}</Button
			>
		</div>
	{/if}
</Modal>
