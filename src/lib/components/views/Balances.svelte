<script lang="ts">
	import { page } from '$app/state';
	import { untrack } from 'svelte';
	import QRCode from 'qrcode';
	import { Wallet, ArrowUpRight, ArrowDownLeft, QrCode, History, ChevronDown } from '@lucide/svelte';
	import { Button } from '$lib/components/ui/button';
	import { Checkbox } from '$lib/components/ui/checkbox';
	import Avatar from '../Avatar.svelte';
	import Modal from '../Modal.svelte';
	import EmptyState from '../EmptyState.svelte';
	import type { AppState, Member } from '$lib/domain/types';
	import type { RunCommand } from '$lib/client/types';
	import { currency, dateLabel, cancelledEntryIds, pairBalance } from '$lib/domain/ledger';
	import { vietQrPayload, bankNames } from '$lib/domain/qr';
	import { preferences } from '$lib/client/preferences.svelte';
	let { appState, actor, run, busy }: { appState: AppState; actor: string; run: RunCommand; busy: boolean } =
		$props();
	let filter = $state('all');
	let expanded = $state<string[]>([]);
	let qrOpen = $state(false);
	let qrPayment = $state<{ id: string; amount: number; recipient: Member } | null>(null);
	let confirmed = $state(false);
	let qrImage = $state('');
	let qrError = $state('');
	let openedRecipient = '';
	$effect(() => {
		const to = page.url.searchParams.get('to');
		if (to && to !== openedRecipient) {
			openedRecipient = to;
			expanded = [...new Set([...expanded, to])];
			untrack(() => {
				void openQr(to);
			});
		}
	});
	const pairs = $derived(
		appState.members
			.filter((m) => m.id !== actor)
			.map((member) => ({ member, balance: pairBalance(appState.ledger, actor, member.id) }))
	);
	const visible = $derived(
		pairs
			.filter((p) => (filter === 'all' ? p.member.active : filter === 'owe' ? p.balance > 0 : p.balance < 0))
			.sort((a, b) => Math.abs(b.balance) - Math.abs(a.balance))
	);
	const owed = $derived(pairs.reduce((s, p) => s + Math.max(0, -p.balance), 0));
	const owing = $derived(pairs.reduce((s, p) => s + Math.max(0, p.balance), 0));
	const recipient = $derived(qrPayment?.recipient);
	function toggleHistory(id: string) {
		expanded = expanded.includes(id) ? expanded.filter((item) => item !== id) : [...expanded, id];
	}
	function qrDisabledReason(member: Member) {
		if (busy) return 'Đang xử lý giao dịch. Vui lòng chờ.';
		if (!member.active) return 'Thành viên chưa được kích hoạt trong nhóm.';
		if (!member.bankCode || !member.bankAccount)
			return `${member.name} chưa cập nhật đầy đủ thông tin ngân hàng.`;
		return '';
	}
	async function openQr(to: string) {
		const person = appState.members.find((member) => member.id === to);
		const amount = pairBalance(appState.ledger, actor, to);
		if (!person?.active || !person.bankCode || !person.bankAccount || amount <= 0) return;
		const payment = { id: crypto.randomUUID(), amount, recipient: structuredClone($state.snapshot(person)) };
		qrPayment = payment;
		confirmed = false;
		qrError = '';
		qrImage = '';
		qrOpen = true;
		try {
			const image = await QRCode.toDataURL(
				vietQrPayload(person.bankCode, person.bankAccount, amount, `CHIATIENAN ${payment.id.slice(0, 8)}`),
				{ width: 320, margin: 2, errorCorrectionLevel: 'M' }
			);
			if (qrPayment?.id === payment.id) qrImage = image;
		} catch {
			if (qrPayment?.id === payment.id) qrError = 'Không tạo được mã QR. Vui lòng mở lại.';
		}
	}
	async function confirmQrPayment() {
		if (!qrPayment || !confirmed) return;
		try {
			await run(
				'confirmQrPayment',
				{ id: qrPayment.id, to: qrPayment.recipient.id, amount: qrPayment.amount },
				'Đã ghi thanh toán.'
			);
			qrOpen = false;
		} catch {
			/* Keep the same payment ID for an idempotent retry. */
		}
	}
</script>

<div class="page-heading">
	<div>
		<h1>Tài khoản của bạn</h1>
	</div>
</div>
<div class="stat-grid">
	<div class="stat-card">
		<div class="stat-label">Bạn đang nợ <ArrowUpRight size={19} /></div>
		<strong class="gain-amount">{currency(owing)}</strong><span class="stat-foot"
			>{pairs.filter((p) => p.balance > 0).length} khoản cần thanh toán</span
		>
	</div>
	<div class="stat-card">
		<div class="stat-label">Bạn đang bị nợ <ArrowDownLeft size={19} /></div>
		<strong class="loss-amount">{currency(owed)}</strong><span class="stat-foot"
			>{pairs.filter((p) => p.balance < 0).length} người cần trả tiền cho bạn</span
		>
	</div>
	<div class="stat-card">
		<div class="stat-label">Nợ - bị nợ <Wallet size={19} /></div>
		<strong class:negative={owing - owed < 0} class:positive={owing - owed > 0}
			>{currency(owing - owed)}</strong
		>
	</div>
</div>
<section class="panel">
	<div class="filter-toolbar">
		<div class="segmented-control">
			<button class:active={filter === 'all'} onclick={() => (filter = 'all')}>Tất cả</button><button
				class:active={filter === 'owe'}
				onclick={() => (filter = 'owe')}>Nợ ({pairs.filter((p) => p.balance > 0).length})</button
			><button class:active={filter === 'owed'} onclick={() => (filter = 'owed')}
				>Bị nợ ({pairs.filter((p) => p.balance < 0).length})</button
			>
		</div>
	</div>
	{#each visible as pair (pair.member.id)}<div class="counterpart">
			<div class="counterpart-main">
				<button
					type="button"
					class="counterpart-row-toggle"
					aria-label={`Xem lịch sử với ${pair.member.name}`}
					aria-expanded={expanded.includes(pair.member.id)}
					aria-controls={`history-${pair.member.id}`}
					onclick={() => toggleHistory(pair.member.id)}
				></button>
				<Avatar member={pair.member} />
				<div class="counterpart-name">
					<strong>{pair.member.name}</strong>
				</div>
				<div class="counterpart-amount">
					<small
						>{pair.balance > 0 ? 'Bạn đang nợ' : pair.balance < 0 ? 'Bạn đang bị nợ' : 'Không còn nợ'}</small
					><strong class:gain-amount={pair.balance > 0} class:loss-amount={pair.balance < 0}
						>{currency(Math.abs(pair.balance))}</strong
					>
				</div>
				<div class="counterpart-actions">
					{#if pair.balance > 0}{@const reason = qrDisabledReason(pair.member)}
						<!-- svelte-ignore a11y_no_noninteractive_tabindex (Keyboard users need to focus the disabled button's reason.) -->
						<span
							class="qr-button-with-tooltip"
							role="group"
							tabindex={reason ? 0 : undefined}
							aria-label={reason ? `Mã QR · ${pair.member.name}` : undefined}
							aria-describedby={reason ? `qr-reason-${pair.member.id}` : undefined}
							><Button variant="outline" disabled={!!reason} onclick={() => openQr(pair.member.id)}
								><QrCode size={16} /> Mã QR</Button
							>{#if reason}<span class="qr-disabled-tooltip" role="tooltip" id={`qr-reason-${pair.member.id}`}
									>{reason}</span
								>{/if}</span
						>{/if}<Button
						variant="ghost"
						class="counterpart-history-trigger"
						aria-label={`Lịch sử với ${pair.member.name}`}
						aria-expanded={expanded.includes(pair.member.id)}
						aria-controls={`history-${pair.member.id}`}
						onclick={() => toggleHistory(pair.member.id)}
						><History size={17} /><ChevronDown size={14} /></Button
					>
				</div>
			</div>
			{#if expanded.includes(pair.member.id)}{@const cancelled = cancelledEntryIds(
					appState.ledger
				)}{@const entries = [...appState.ledger]
					.filter(
						(e) =>
							e.type === 'debt' &&
							e.source !== 'settlement' &&
							!cancelled.has(e.id) &&
							((e.from === actor && e.to === pair.member.id) || (e.to === actor && e.from === pair.member.id))
					)
					.sort((a, b) => b.date.localeCompare(a.date))}
				<div class="counterpart-history" id={`history-${pair.member.id}`}>
					<div class="counterpart-history-heading">
						<span>Các khoản nợ gần đây</span><small>{entries.length} khoản</small>
					</div>
					{#each entries as entry}<div class="counterpart-history-entry">
							<div class="counterpart-history-info">
								<strong>{entry.description || 'Khoản nợ'}</strong>
								<small
									>{dateLabel(entry.date)} · {entry.from === actor
										? `Bạn nợ ${pair.member.name}`
										: `${pair.member.name} nợ bạn`}</small
								>
							</div>
							<strong
								class="counterpart-history-amount"
								class:gain-amount={entry.from === actor}
								class:loss-amount={entry.to === actor}>{currency(entry.amount)}</strong
							>
						</div>{/each}{#if !entries.length}<p class="counterpart-history-empty">
							Chưa có khoản nợ trực tiếp; số dư có thể đến từ tối giản nợ.
						</p>{/if}
				</div>{/if}
		</div>{/each}{#if !visible.length}<EmptyState
			title="Không có nợ"
			description="Không có nợ trong phạm vi bạn đã chọn."
		/>{/if}
</section>
<Modal
	bind:open={qrOpen}
	title="Chuyển tiền bằng QR"
	description={preferences.testView ? 'Tài khoản ngân hàng mẫu · Không chuyển tiền khi thử nghiệm.' : ''}
>
	{#if qrPayment && recipient}<div class="qr-content">
			{#if qrImage}<img
					src={qrImage}
					alt="Mã VietQR cho khoản thanh toán thử nghiệm"
					width="240"
					height="240"
				/>{/if}
			<h2>{currency(qrPayment.amount)}</h2>
			<strong>{recipient.name}</strong>
			<p>
				{recipient.bankLabel || bankNames[recipient.bankCode] || recipient.bankCode} · {recipient.bankAccount}
			</p>
			{#if qrError}<p class="validation-error" role="alert">{qrError}</p>{/if}
		</div>
		<label class="checkbox-label"
			><Checkbox bind:checked={confirmed} aria-label="Đã chuyển khoản xong" />Đã chuyển khoản xong</label
		>
		<div class="modal-actions">
			<Button variant="outline" disabled={busy} onclick={() => (qrOpen = false)}>Đóng</Button><Button
				disabled={busy || !confirmed || !qrImage}
				onclick={confirmQrPayment}>Đã thanh toán</Button
			>
		</div>{/if}
</Modal>
