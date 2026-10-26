<script lang="ts">
	import Modal from './Modal.svelte';
	import type { AppState, Bill } from '$lib/domain/types';
	import { currency, billDateLabel, dateTimeLabel } from '$lib/domain/ledger';
	let {
		open = $bindable(false),
		bill,
		appState
	}: { open: boolean; bill?: Bill; appState: AppState } = $props();
	const name = (id: string) => appState.members.find((member) => member.id === id)?.name || id;
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
	{/if}
</Modal>
