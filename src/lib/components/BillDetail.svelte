<script lang="ts">
	import { Mail, RotateCcw, Eye } from '@lucide/svelte';
	import { Button } from '$lib/components/ui/button';
	import Modal from './Modal.svelte';
	import type { AppState, Bill } from '$lib/domain/types';
	import type { RunCommand } from '$lib/client/types';
	import { currency, billDateLabel, dateTimeLabel, receiptHtml } from '$lib/domain/ledger';
	import { preferences } from '$lib/client/preferences.svelte';
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
	let mailOpen = $state(false);
	const name = (id: string) => appState.members.find((member) => member.id === id)?.name || id;
	const receipt = $derived(appState.receipts.find((item) => item.billId === bill?.id));
	const canProcess = $derived(
		bill?.organizer === actor || appState.members.find((member) => member.id === actor)?.role === 'admin'
	);
	const receiptLabels = { queued: 'Chờ mô phỏng', simulated: 'Đã mô phỏng', failed: 'Mô phỏng thất bại' };
	async function simulate(fail: boolean) {
		if (receipt) {
			try {
				await run(
					'simulateReceipt',
					{ id: receipt.id, fail },
					fail ? 'Đã mô phỏng tình huống gửi lỗi.' : 'Đã mô phỏng gửi biên nhận; không có email thật.'
				);
			} catch {}
		}
	}
</script>

<Modal
	bind:open
	title={bill?.description || 'Chi tiết hóa đơn'}
	description={bill
		? `${name(bill.organizer)} đã thanh toán · ${billDateLabel(bill.date)} · Tạo: ${dateTimeLabel(bill.createdAt)}`
		: ''}
	wide
	>{#if bill}<div class="review-lines">
			{#each bill.lines as line}<div>
					<span
						><strong>{name(line.memberId)}{line.memberId === bill.organizer ? ' · Người trả' : ''}</strong
						><small>{line.description}{line.note ? ` · ${line.note}` : ''}</small></span
					><strong>{currency(line.amount)}</strong>
				</div>{/each}
		</div>
		<div class="summary-total"><span>Tổng hóa đơn</span><strong>{currency(bill.total)}</strong></div>
		{#if receipt}<div class="receipt-detail">
				<div>
					<Mail size={18} /><strong>Biên nhận chung</strong><span class="status-pill"
						>{receiptLabels[receipt.status]}</span
					>
				</div>
				<p>{receipt.recipients.join(', ')}</p>
				{#if preferences.testView}<p class="fine-print">
						Đã thử {receipt.attempts} lần. Không gửi thư thật trong môi trường cục bộ.
					</p>{/if}
				{#if receipt.error}<p class="validation-error">{receipt.error}</p>{/if}
				<div class="button-row">
					<Button variant="outline" onclick={() => (mailOpen = true)}><Eye size={15} /> Xem email</Button
					>{#if canProcess && preferences.testView}<Button disabled={busy} onclick={() => simulate(false)}
							><RotateCcw size={15} />{receipt.status === 'failed'
								? 'Thử lại mô phỏng'
								: 'Mô phỏng gửi'}</Button
						><Button variant="ghost" disabled={busy} onclick={() => simulate(true)}>Mô phỏng lỗi</Button>{/if}
				</div>
			</div>{/if}
	{/if}</Modal
>
<Modal
	bind:open={mailOpen}
	title="Xem trước biên nhận email"
	description="Nội dung được tạo từ ảnh chụp hóa đơn lúc ghi nhận. Chưa gửi thư."
	wide
	>{#if bill}<iframe
			title="Nội dung biên nhận email"
			srcdoc={receiptHtml(bill, appState.members)}
			sandbox=""
			class="email-preview"
		></iframe>{/if}</Modal
>
