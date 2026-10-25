<script lang="ts">
	import QRCode from 'qrcode';
	import { Wallet, ArrowUpRight, ArrowDownLeft, QrCode, Check, History, Copy } from '@lucide/svelte';
	import { Button } from '$lib/components/ui/button';
	import { Checkbox } from '$lib/components/ui/checkbox';
	import Avatar from '../Avatar.svelte';
	import Modal from '../Modal.svelte';
	import EmptyState from '../EmptyState.svelte';
	import type { AppState, Member } from '$lib/domain/types';
	import type { RunCommand } from '$lib/client/types';
	import { currency, dateLabel, pairBalance } from '$lib/domain/ledger';
	import { vietQrPayload, bankNames } from '$lib/domain/qr';
	let { appState, actor, run, busy }: { appState: AppState; actor: string; run: RunCommand; busy: boolean } =
		$props();
	let filter = $state('all');
	let scope = $state('all');
	let historyLimit = $state(3);
	let expanded = $state('');
	let qrOpen = $state(false);
	let qrPayment = $state<{ id: string; amount: number; recipient: Member } | null>(null);
	let confirmed = $state(false);
	let qrImage = $state('');
	let qrError = $state('');
	let copied = $state(false);
	const pairs = $derived(
		appState.members
			.filter((m) => m.id !== actor && (scope === 'all' || m.active))
			.map((member) => ({ member, balance: pairBalance(appState.ledger, actor, member.id) }))
			.filter((p) => p.balance !== 0)
	);
	const visible = $derived(
		pairs
			.filter((p) => filter === 'all' || (filter === 'owe' ? p.balance > 0 : p.balance < 0))
			.sort((a, b) => Math.abs(b.balance) - Math.abs(a.balance))
	);
	const owed = $derived(pairs.reduce((s, p) => s + Math.max(0, -p.balance), 0));
	const owing = $derived(pairs.reduce((s, p) => s + Math.max(0, p.balance), 0));
	const recipient = $derived(qrPayment?.recipient);
	async function openQr(to: string) {
		const person = appState.members.find((member) => member.id === to);
		const amount = pairBalance(appState.ledger, actor, to);
		if (!person?.bankCode || !person.bankAccount || amount <= 0) return;
		const payment = { id: crypto.randomUUID(), amount, recipient: structuredClone($state.snapshot(person)) };
		qrPayment = payment;
		confirmed = false;
		copied = false;
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
	async function copyAccount() {
		if (recipient) {
			await navigator.clipboard.writeText(recipient.bankAccount);
			copied = true;
		}
	}
</script>

<div class="page-heading">
	<div>
		<h1>Số dư cá nhân</h1>
		<p>Nợ được đối trừ theo từng cặp, gồm cả lịch sử thành viên cũ.</p>
	</div>
</div>
<div class="stat-grid">
	<div class="stat-card">
		<div class="stat-label">Bạn đang lỗ <ArrowDownLeft size={19} /></div>
		<strong class="loss-amount">{currency(owed)}</strong><span class="stat-foot"
			>{pairs.filter((p) => p.balance < 0).length} người cần trả tiền cho bạn</span
		>
	</div>
	<div class="stat-card">
		<div class="stat-label">Bạn đang lãi <ArrowUpRight size={19} /></div>
		<strong class="gain-amount">{currency(owing)}</strong><span class="stat-foot"
			>{pairs.filter((p) => p.balance > 0).length} khoản cần thanh toán</span
		>
	</div>
	<div class="stat-card net-card">
		<div class="stat-label">Số dư ròng <Wallet size={19} /></div>
		<strong>{currency(owed - owing)}</strong><span class="stat-foot"
			>{scope === 'all' ? 'Toàn bộ lịch sử' : 'Chỉ quan hệ giữa thành viên đang hoạt động'}</span
		>
	</div>
</div>
<section class="panel">
	<div class="filter-toolbar">
		<div class="segmented-control">
			<button class:active={filter === 'all'} onclick={() => (filter = 'all')}>Tất cả ({pairs.length})</button
			><button class:active={filter === 'owe'} onclick={() => (filter = 'owe')}>Lãi</button><button
				class:active={filter === 'owed'}
				onclick={() => (filter = 'owed')}>Lỗ</button
			>
		</div>
		<div class="filter-selects">
			<label class="sr-only" for="balance-scope">Phạm vi thành viên</label><select
				id="balance-scope"
				bind:value={scope}
				><option value="all">Gồm thành viên cũ</option><option value="active">Đang hoạt động</option></select
			><label class="sr-only" for="recent-count">Số khoản nợ gần đây</label><select
				id="recent-count"
				bind:value={historyLimit}
				><option value={1}>1 khoản gần đây</option><option value={3}>3 khoản gần đây</option><option value={5}
					>5 khoản gần đây</option
				><option value={10}>10 khoản gần đây</option><option value={9999}>Toàn bộ khoản nợ</option></select
			>
		</div>
	</div>
	{#each visible as pair}<div class="counterpart">
			<div class="counterpart-main">
				<Avatar member={pair.member} />
				<div class="counterpart-name">
					<strong>{pair.member.name}</strong>{#if !pair.member.active}<small>Thành viên cũ · Vẫn giữ nợ</small
						>{/if}
				</div>
				<div class="counterpart-amount">
					<small>{pair.balance > 0 ? 'Bạn đang lãi' : 'Bạn đang lỗ'}</small><strong
						class:gain-amount={pair.balance > 0}
						class:loss-amount={pair.balance < 0}>{currency(Math.abs(pair.balance))}</strong
					>
				</div>
				<div class="counterpart-actions">
					{#if pair.balance > 0}<Button
							variant="outline"
							disabled={busy || !pair.member.bankAccount || !pair.member.bankCode}
							onclick={() => openQr(pair.member.id)}><QrCode size={16} /> Mã QR</Button
						>{/if}<Button
						variant="ghost"
						aria-label={`Lịch sử với ${pair.member.name}`}
						onclick={() => (expanded = expanded === pair.member.id ? '' : pair.member.id)}
						><History size={17} /></Button
					>
				</div>
			</div>
			{#if expanded === pair.member.id}{@const entries = [...appState.ledger]
					.filter(
						(e) =>
							e.type === 'debt' &&
							e.source !== 'settlement' &&
							((e.from === actor && e.to === pair.member.id) || (e.to === actor && e.from === pair.member.id))
					)
					.sort((a, b) => b.date.localeCompare(a.date))
					.slice(0, historyLimit)}
				<div class="counterpart-history">
					<p>Các khoản nợ gần đây · Không phải danh sách hóa đơn chưa trả</p>
					{#each entries as entry}<div>
							<span>{dateLabel(entry.date)} · {entry.description}</span><strong
								>{currency(entry.amount)}</strong
							>
						</div>{/each}{#if !entries.length}<p>
							Chưa có khoản nợ trực tiếp; số dư có thể đến từ điều phối.
						</p>{/if}
				</div>{/if}
		</div>{/each}{#if !visible.length}<EmptyState
			title="Không có nợ"
			description="Không có nợ trong phạm vi bạn đã chọn."
		/>{/if}
</section>
<Modal
	bind:open={qrOpen}
	title="Thanh toán bằng VietQR"
	description="Tài khoản ngân hàng mẫu · Không chuyển tiền khi thử nghiệm."
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
				{recipient.bankLabel || bankNames[recipient.bankCode] || recipient.bankCode} · {recipient.bankAccount}<button
					class="icon-button"
					aria-label="Sao chép số tài khoản"
					onclick={copyAccount}
					>{#if copied}<Check size={14} />{:else}<Copy size={14} />{/if}</button
				>
			</p>
			<small>{recipient.bankName}</small>
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
