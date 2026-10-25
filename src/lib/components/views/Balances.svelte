<script lang="ts">
	import { onMount } from 'svelte';
	import { page } from '$app/state';
	import QRCode from 'qrcode';
	import {
		Wallet,
		ArrowUpRight,
		ArrowDownLeft,
		QrCode,
		Check,
		ArrowRight,
		History,
		CircleAlert,
		Copy,
		Plus,
		Clock
	} from '@lucide/svelte';
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import { Checkbox } from '$lib/components/ui/checkbox';
	import Avatar from '../Avatar.svelte';
	import Modal from '../Modal.svelte';
	import EmptyState from '../EmptyState.svelte';
	import type { AppState } from '$lib/domain/types';
	import type { RunCommand } from '$lib/client/types';
	import { currency, dateLabel, pairBalance, netBalance } from '$lib/domain/ledger';
	import { vietQrPayload, bankNames } from '$lib/domain/qr';
	let { appState, actor, run, busy }: { appState: AppState; actor: string; run: RunCommand; busy: boolean } =
		$props();
	let filter = $state('all');
	let scope = $state('all');
	let historyLimit = $state(3);
	let expanded = $state('');
	let manualOpen = $state(false);
	let manualReview = $state(false);
	let paymentTo = $state('');
	let paymentAmount = $state(0);
	let paymentDescription = $state('Chuyển khoản hoàn tiền');
	let paymentNote = $state('');
	let paymentId = $state(crypto.randomUUID());
	let additionalPayments = $state<{ to: string; amount: number }[]>([]);
	const payments = $derived([{ to: paymentTo, amount: paymentAmount }, ...additionalPayments]);
	let validation = $state('');
	let qrOpen = $state(false);
	let intentId = $state('');
	let confirmed = $state(false);
	let qrImage = $state('');
	let now = $state(Date.now());
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
	const intent = $derived(appState.intents.find((i) => i.id === intentId));
	const recipient = $derived(appState.members.find((m) => m.id === intent?.to));
	const remaining = $derived(
		intent ? Math.max(0, Math.ceil((new Date(intent.expiresAt).getTime() - now) / 1000)) : 0
	);
	const pendingIntents = $derived(
		appState.intents.filter(
			(i) => i.from === actor && i.status === 'pending' && new Date(i.expiresAt).getTime() > now
		)
	);
	onMount(() => {
		if (page.url.searchParams.has('manual')) openManual();
		const timer = setInterval(() => (now = Date.now()), 1000);
		return () => clearInterval(timer);
	});
	async function showIntent(id: string) {
		intentId = id;
		confirmed = false;
		qrImage = '';
		qrOpen = true;
		const selected = appState.intents.find((i) => i.id === id)!;
		const person = appState.members.find((m) => m.id === selected.to)!;
		qrImage = await QRCode.toDataURL(
			vietQrPayload(
				person.bankCode,
				person.bankAccount,
				selected.amount,
				`BEPCHUNG ${selected.id.slice(0, 8)}`
			),
			{ width: 320, margin: 2, errorCorrectionLevel: 'M' }
		);
	}
	async function createIntent(to: string) {
		try {
			const id = crypto.randomUUID();
			await run('createIntent', { id, to }, 'Đã tạo yêu cầu thanh toán trong 2 phút.');
			await showIntent(id);
		} catch {
			/* Error shown by app shell. */
		}
	}
	async function confirmIntent() {
		try {
			await run('confirmIntent', { id: intentId }, 'Đã ghi nhận bạn tự xác nhận thanh toán.');
			qrOpen = false;
		} catch {
			/* Leave the intent visible for review. */
		}
	}
	async function cancelIntent() {
		try {
			await run('cancelIntent', { id: intentId }, 'Đã hủy yêu cầu thanh toán.');
			qrOpen = false;
		} catch {}
	}
	function openManual(to = '') {
		paymentTo =
			to ||
			pairs.find((p) => p.balance > 0)?.member.id ||
			appState.members.find((m) => m.id !== actor)?.id ||
			'';
		paymentAmount = Math.max(0, pairBalance(appState.ledger, actor, paymentTo));
		paymentDescription = 'Chuyển khoản hoàn tiền';
		paymentNote = '';
		paymentId = crypto.randomUUID();
		additionalPayments = [];
		manualReview = false;
		validation = '';
		manualOpen = true;
	}
	function reviewPayment() {
		if (
			payments.some(
				(payment) => !payment.to || !Number.isSafeInteger(payment.amount) || payment.amount <= 0
			) ||
			new Set(payments.map((payment) => payment.to)).size !== payments.length ||
			!paymentDescription.trim()
		)
			validation = 'Mỗi người nhận cần khác nhau, có số tiền nguyên dương và nội dung thanh toán.';
		else {
			validation = '';
			manualReview = true;
		}
	}
	async function recordPayment() {
		try {
			await run(
				'recordPayments',
				{
					id: paymentId,
					payments,
					description: paymentDescription,
					note: paymentNote
				},
				'Đã ghi khoản hoàn tiền.'
			);
			manualOpen = false;
		} catch {}
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
		<div class="eyebrow">RÕ RÀNG TỪNG KHOẢN CHIA</div>
		<h1>Số dư cá nhân</h1>
		<p>Công nợ được đối trừ theo từng cặp, gồm cả lịch sử thành viên cũ.</p>
	</div>
	<Button onclick={() => openManual()}><Plus size={17} /> Ghi khoản hoàn tiền</Button>
</div>
<div class="stat-grid">
	<div class="stat-card">
		<div class="stat-label">Bạn được nhận <ArrowDownLeft size={19} /></div>
		<strong class="positive">{currency(owed)}</strong><span class="stat-foot"
			>{pairs.filter((p) => p.balance < 0).length} người cần hoàn lại cho bạn</span
		>
	</div>
	<div class="stat-card">
		<div class="stat-label">Bạn cần trả <ArrowUpRight size={19} /></div>
		<strong class="negative">{currency(owing)}</strong><span class="stat-foot"
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
{#if pendingIntents.length}<div class="notice warm">
		<Clock size={18} /><span>Bạn có {pendingIntents.length} yêu cầu QR đang chờ.</span
		>{#each pendingIntents as pending}<button class="text-link" onclick={() => showIntent(pending.id)}
				>{appState.members.find((m) => m.id === pending.to)?.name} <ArrowRight size={15} /></button
			>{/each}
	</div>{/if}
<section class="panel">
	<div class="filter-toolbar">
		<div class="segmented-control">
			<button class:active={filter === 'all'} onclick={() => (filter = 'all')}>Tất cả ({pairs.length})</button
			><button class:active={filter === 'owe'} onclick={() => (filter = 'owe')}>Cần trả</button><button
				class:active={filter === 'owed'}
				onclick={() => (filter = 'owed')}>Được nhận</button
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
					<strong>{pair.member.name}</strong><small
						>{pair.member.active ? pair.member.team : 'Thành viên cũ · Vẫn giữ công nợ'}</small
					>
				</div>
				<div class="counterpart-amount">
					<small>{pair.balance > 0 ? 'Bạn cần trả' : 'Bạn được nhận'}</small><strong
						class:negative={pair.balance > 0}
						class:positive={pair.balance < 0}>{currency(Math.abs(pair.balance))}</strong
					>
				</div>
				<div class="counterpart-actions">
					{#if pair.balance > 0}<Button
							variant="outline"
							disabled={busy || !pair.member.bankAccount}
							onclick={() => createIntent(pair.member.id)}><QrCode size={16} /> Mã QR</Button
						><Button
							variant="ghost"
							aria-label={`Ghi hoàn tiền cho ${pair.member.name}`}
							onclick={() => openManual(pair.member.id)}><Check size={16} /></Button
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
			title="Mọi khoản đã gọn gàng"
			description="Không có công nợ trong phạm vi bạn đã chọn."
		/>{/if}
</section>
<div class="notice">
	<CircleAlert size={18} />
	<p>
		Khoản trả tiền được đối trừ vào công nợ giữa hai người, không gắn với từng hóa đơn. Xác nhận QR là lời xác
		nhận của người trả, chưa được ngân hàng kiểm chứng.
	</p>
</div>
<Modal
	bind:open={manualOpen}
	title={manualReview ? 'Xác nhận khoản hoàn tiền' : 'Ghi khoản hoàn tiền'}
	description="Ghi nhận giao dịch bạn đã thực hiện. Ứng dụng không chuyển tiền."
>
	{#if !manualReview}<label class="field"
			>Người nhận<select bind:value={paymentTo}
				>{#each appState.members.filter((m) => m.id !== actor) as member}<option value={member.id}
						>{member.name}{!member.active ? ' (thành viên cũ)' : ''}</option
					>{/each}</select
			></label
		><label class="field"
			>Số tiền (đồng)<Input type="number" min="1" step="1" bind:value={paymentAmount} /></label
		>
		{#each additionalPayments as payment, index}
			<div class="additional-payment">
				<label class="field"
					>Người nhận {index + 2}<select bind:value={payment.to}
						>{#each appState.members.filter((member) => member.id !== actor) as member}<option
								value={member.id}>{member.name}{!member.active ? ' (thành viên cũ)' : ''}</option
							>{/each}</select
					></label
				>
				<label class="field"
					>Số tiền người nhận {index + 2} (đồng)<Input
						type="number"
						min="1"
						step="1"
						bind:value={payment.amount}
					/></label
				>
				<Button
					variant="ghost"
					onclick={() => (additionalPayments = additionalPayments.filter((_, i) => i !== index))}
					>Bỏ người nhận này</Button
				>
			</div>
		{/each}
		<Button
			variant="outline"
			disabled={payments.length >= appState.members.length - 1}
			onclick={() =>
				(additionalPayments = [
					...additionalPayments,
					{
						to:
							appState.members.find(
								(member) => member.id !== actor && !payments.some((payment) => payment.to === member.id)
							)?.id || '',
						amount: 0
					}
				])}><Plus size={15} /> Thêm người nhận</Button
		>
		<label class="field">Nội dung<Input bind:value={paymentDescription} maxlength={300} /></label><label
			class="field">Ghi chú<Input bind:value={paymentNote} maxlength={500} /></label
		>{#if validation}<p class="validation-error">{validation}</p>{/if}<Button onclick={reviewPayment}
			>Xem lại <ArrowRight size={16} /></Button
		>{:else}<div class="payment-review">
			{#if payments.length === 1}<Avatar
					member={appState.members.find((m) => m.id === paymentTo)}
					size="large"
				/><strong>{appState.members.find((m) => m.id === paymentTo)?.name}</strong>{:else}<strong
					>Hoàn tiền cho {payments.length} người nhận</strong
				>{/if}
			<h2>{currency(payments.reduce((sum, payment) => sum + payment.amount, 0))}</h2>
			<p>{paymentDescription}</p>
			{#if payments.length > 1}<div class="review-lines full-width">
					{#each payments as payment}<div>
							<span>{appState.members.find((member) => member.id === payment.to)?.name}</span><strong
								>{currency(payment.amount)}</strong
							>
						</div>{/each}
				</div>{/if}
			{#if payments.some((payment) => payment.amount > Math.max(0, pairBalance(appState.ledger, actor, payment.to)))}<p
					class="notice warm"
				>
					Số tiền lớn hơn khoản bạn đang nợ. Phần vượt sẽ trở thành khoản bạn được nhận.
				</p>{/if}
		</div>
		<div class="modal-actions">
			<Button variant="outline" onclick={() => (manualReview = false)} disabled={busy}>Chỉnh sửa</Button
			><Button onclick={recordPayment} disabled={busy}>Xác nhận đã trả</Button>
		</div>{/if}
</Modal>
<Modal
	bind:open={qrOpen}
	title="Thanh toán bằng VietQR"
	description="Tài khoản ngân hàng mẫu · Không chuyển tiền khi thử nghiệm."
>
	{#if intent && recipient}<div class="qr-content">
			{#if qrImage}<img
					src={qrImage}
					alt="Mã VietQR cho khoản thanh toán thử nghiệm"
					width="240"
					height="240"
				/>{/if}
			<h2>{currency(intent.amount)}</h2>
			<strong>{recipient.name}</strong>
			<p>
				{bankNames[recipient.bankCode] || recipient.bankCode} · {recipient.bankAccount}<button
					class="icon-button"
					aria-label="Sao chép số tài khoản"
					onclick={copyAccount}
					>{#if copied}<Check size={14} />{:else}<Copy size={14} />{/if}</button
				>
			</p>
			<small>{recipient.bankName}</small><span class:negative={remaining === 0} class="expiry"
				><Clock size={14} />{remaining > 0
					? `Còn ${Math.floor(remaining / 60)}:${String(remaining % 60).padStart(2, '0')}`
					: 'Yêu cầu đã hết hạn'}</span
			>
		</div>
		<label class="checkbox-label"
			><Checkbox
				bind:checked={confirmed}
				disabled={remaining === 0}
				aria-label="Tôi xác nhận đã chuyển khoản"
			/>Tôi xác nhận đã chuyển khoản thành công</label
		>
		<p class="fine-print">
			Chỉ xác nhận sau khi đã kiểm tra giao dịch. Bếp Chung không tự xác minh ngân hàng. Mã QR được tạo ngay
			trên thiết bị.
		</p>
		<div class="modal-actions">
			<Button variant="outline" disabled={busy} onclick={cancelIntent}>Hủy yêu cầu</Button><Button
				disabled={busy || !confirmed || remaining === 0}
				onclick={confirmIntent}>Đã thanh toán</Button
			>
		</div>{/if}
</Modal>
