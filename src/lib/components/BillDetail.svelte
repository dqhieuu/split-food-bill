<script lang="ts">
	import { MessageCircle, RotateCcw } from '@lucide/svelte';
	import { Button } from '$lib/components/ui/button';
	import Modal from './Modal.svelte';
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
	const name = (id: string) => appState.members.find((member) => member.id === id)?.name || id;
	const receipt = $derived(
		bill?.discordNotification ? appState.receipts.find((item) => item.billId === bill?.id) : undefined
	);
	const canProcess = $derived(
		bill?.organizer === actor || appState.members.find((member) => member.id === actor)?.role === 'admin'
	);
	const receiptLabels = {
		queued: 'Chờ gửi',
		sending: 'Đang gửi',
		sent: 'Đã gửi',
		simulated: 'Đã mô phỏng',
		failed: 'Gửi thất bại'
	};
	async function retryNotification() {
		if (!receipt) return;
		try {
			await run('retryBillNotification', { id: receipt.id }, 'Đã xử lý gửi lại thông báo Discord.');
		} catch {}
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
		{#if receipt}<div class="receipt-detail">
				<div>
					<MessageCircle size={18} /><strong>Thông báo Discord</strong><span class="status-pill"
						>{receiptLabels[receipt.status]}</span
					>
				</div>
				{#each receipt.deliveries as delivery}<p>
						{name(delivery.memberId)} · {receiptLabels[delivery.status]}
					</p>{/each}
				{#if receipt.error}<p class="validation-error">{receipt.error}</p>{/if}
				{#if canProcess && receipt.status === 'failed'}<Button
						variant="outline"
						disabled={busy}
						onclick={retryNotification}><RotateCcw size={15} />Gửi lại thông báo thất bại</Button
					>{/if}
			</div>{/if}
	{/if}
</Modal>
