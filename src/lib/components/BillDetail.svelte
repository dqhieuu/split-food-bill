<script lang="ts">
	import { Undo2 } from '@lucide/svelte';
	import Modal from './Modal.svelte';
	import { Button } from '$lib/components/ui/button';
	import type { AppState, Bill } from '$lib/domain/types';
	import type { RunCommand } from '$lib/client/types';
	import { currency, billDateLabel, dateTimeLabel } from '$lib/domain/ledger';
	let {
		open = $bindable(false),
		bill,
		appState,
		actor,
		run,
		busy
	}: {
		open: boolean;
		bill?: Bill;
		appState: AppState;
		actor: string;
		run: RunCommand;
		busy: boolean;
	} = $props();
	let confirming = $state(false);
	const name = (id: string) => appState.members.find((member) => member.id === id)?.name || id;
	const canUndo = $derived(
		!!bill &&
			!bill.undoneAt &&
			(bill.organizer === actor || appState.members.find((member) => member.id === actor)?.role === 'admin')
	);
	$effect(() => {
		if (!open || bill?.undoneAt) confirming = false;
	});
	async function undo() {
		if (!bill) return;
		await run('undoBill', { id: bill.id }, 'Đã hoàn tác hóa đơn.').catch(() => {});
	}
</script>

<Modal
	bind:open
	title={bill?.description || 'Chi tiết hóa đơn'}
	description={bill
		? `${name(bill.organizer)} đã thanh toán · ${billDateLabel(bill.date)} · Tạo: ${dateTimeLabel(bill.createdAt)}`
		: ''}
	wide
>
	{#if bill}
		{#if bill.undoneAt}<p class="notice warm" role="status">
				<Undo2 size={16} />Đã hoàn tác bởi {name(bill.undoneBy ?? '')} lúc {dateTimeLabel(bill.undoneAt)}. Các
				khoản nợ đã được bù trừ trong ledger; hóa đơn này không thể hoàn tác lại.
			</p>{/if}
		<div class="review-lines">
			{#each bill.lines as line}<div>
					<span
						><strong>{name(line.memberId)}{line.memberId === bill.organizer ? ' · Người trả' : ''}</strong
						><small>{line.description}{line.note ? ` · ${line.note}` : ''}</small></span
					>
					<strong>{currency(line.amount)}</strong>
				</div>{/each}
		</div>
		<div class="summary-total"><span>Tổng hóa đơn</span><strong>{currency(bill.total)}</strong></div>
		{#if canUndo}
			{#if confirming}<p class="fine-print" role="alert">
					Hoàn tác sẽ ghi các bút toán bù trừ để xóa mọi khoản nợ của hóa đơn này. Thao tác chỉ thực hiện được
					một lần và không thể khôi phục.
				</p>
				<div class="modal-actions">
					<Button variant="outline" disabled={busy} onclick={() => (confirming = false)}>Giữ hóa đơn</Button
					><Button variant="destructive" disabled={busy} onclick={undo}
						><Undo2 size={16} />{busy ? 'Đang hoàn tác…' : 'Xác nhận hoàn tác'}</Button
					>
				</div>
			{:else}<div class="modal-actions">
					<Button variant="destructive" disabled={busy} onclick={() => (confirming = true)}
						><Undo2 size={16} /> Hoàn tác hóa đơn</Button
					>
				</div>{/if}
		{/if}
	{/if}
</Modal>
