<script lang="ts">
	import { Undo2, Check } from '@lucide/svelte';
	import Modal from './Modal.svelte';
	import BillImage from './BillImage.svelte';
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
		busy,
		groupId,
		readOnly = false
	}: {
		open: boolean;
		bill?: Bill;
		appState: AppState;
		actor: string;
		run: RunCommand;
		busy: boolean;
		groupId: string;
		readOnly?: boolean;
	} = $props();
	let confirming = $state(false);
	const name = (id: string) => appState.members.find((member) => member.id === id)?.name || id;
	const currentMember = $derived(appState.members.find((member) => member.id === actor));
	const canUndo = $derived(
		!readOnly &&
			!!bill &&
			!bill.undoneAt &&
			currentMember?.active &&
			(bill.organizer === actor || currentMember.role === 'admin')
	);
	$effect(() => {
		if (!open || bill?.undoneAt) confirming = false;
	});
	async function undo() {
		if (!bill || !canUndo) return;
		await run('undoBill', { id: bill.id }, 'Đã hoàn tác hóa đơn.').catch(() => {});
	}
</script>

<Modal
	bind:open
	title={bill?.description || 'Chi tiết hóa đơn'}
	description={bill
		? `${name(bill.organizer)} thanh toán · ${billDateLabel(bill.date)} · Tạo: ${dateTimeLabel(bill.createdAt)}${bill.creator && bill.creator !== bill.organizer ? ` · Người ghi: ${name(bill.creator)}` : ''}`
		: ''}
	wide
>
	{#if bill}
		{#if bill.alreadyPaid && !bill.undoneAt}<p class="paid-bill-status" role="status">
				<Check size={16} />Mọi người đã thanh toán đầy đủ. Hóa đơn không phát sinh nợ mới.
			</p>{/if}
		{#if bill.undoneAt}<p class="notice warm" role="status">
				<Undo2 size={16} />Đã hoàn tác bởi {name(bill.undoneBy ?? '')} lúc {dateTimeLabel(bill.undoneAt)}. Các
				khoản nợ đã được bù trừ trong ledger; hóa đơn này không thể hoàn tác lại.
			</p>{/if}
		{#if bill.image && open}<div class="bill-detail-image">
				<BillImage {groupId} imageId={bill.image} />
			</div>{/if}
		<div class="review-lines bill-detail-lines">
			{#each bill.lines as line}<div>
					<span
						><strong
							>{name(line.memberId)}{line.memberId === bill.organizer ? ' (Trả tiền hoá đơn)' : ''}</strong
						><small>{line.description}{line.note ? ` · ${line.note}` : ''}</small></span
					>
					<strong>{currency(line.amount)}</strong>
				</div>{/each}
		</div>
		<div class="summary-total"><span>Tổng hóa đơn</span><strong>{currency(bill.total)}</strong></div>
		{#if canUndo}
			{#if confirming}<p class="fine-print" role="alert">
					{#if bill.alreadyPaid}Hoàn tác sẽ bù trừ cả khoản nợ và khoản trả của hóa đơn này. Số dư nợ hiện tại
						không thay đổi. Bạn sẽ không thể đảo ngược hành động này.
					{:else}Hoàn tác sẽ thêm vào ledger các khoản nợ nghịch đảo của hoá đơn này. VD A nợ B 100 nghìn, thì
						sau khi hoàn tác sẽ có thêm B nợ A 100 nghìn -&gt; không ai nợ nhau. Bạn sẽ không thể đảo ngược
						hành động này.{/if}
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
