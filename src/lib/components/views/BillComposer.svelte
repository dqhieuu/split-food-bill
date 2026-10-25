<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { Plus, ArrowLeft, ArrowRight, Check, Mail, ReceiptText, Users, Save, Info } from '@lucide/svelte';
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import { Switch } from '$lib/components/ui/switch';
	import { Checkbox } from '$lib/components/ui/checkbox';
	import Modal from '../Modal.svelte';
	import Avatar from '../Avatar.svelte';
	import type { AppState, BillLine } from '$lib/domain/types';
	import type { RunCommand } from '$lib/client/types';
	import { currency, splitAmount, localDate } from '$lib/domain/ledger';
	let { appState, actor, run, busy }: { appState: AppState; actor: string; run: RunCommand; busy: boolean } =
		$props();
	let description = $state('');
	let date = $state(localDate(new Date()));
	let selected = $state<string[]>([]);
	let amounts = $state<Record<string, number>>({});
	let descriptions = $state<Record<string, string>>({});
	let notes = $state<Record<string, string>>({});
	let mode = $state('manual');
	let totalInput = $state(0);
	let unit = $state(1000);
	let emailReceipt = $state(true);
	let confirmOpen = $state(false);
	let validation = $state('');
	let draftReady = $state(false);
	let submissionId = $state(crypto.randomUUID());
	let lastSaved = $state('');
	const people = $derived(appState.members.filter((m) => m.active));
	const split = $derived(
		splitAmount(
			Math.round((totalInput || 0) * unit),
			selected.map(() => 1)
		)
	);
	const lines = $derived<BillLine[]>(
		selected.map((memberId, i) => ({
			memberId,
			amount: mode === 'equal' ? split[i] : Math.round((amounts[memberId] || 0) * unit),
			description: descriptions[memberId] || description,
			note: notes[memberId] || ''
		}))
	);
	const total = $derived(lines.reduce((s, l) => s + l.amount, 0));
	const payer = $derived(appState.members.find((m) => m.id === actor)!);
	onMount(() => {
		selected = [actor];
		try {
			const saved = localStorage.getItem(`lunchroom-draft-${actor}`);
			if (saved) {
				const draft = JSON.parse(saved);
				description = draft.description;
				date = draft.date;
				selected = draft.selected.filter((id: string) => people.some((m) => m.id === id));
				amounts = draft.amounts;
				descriptions = draft.descriptions;
				notes = draft.notes;
				mode = draft.mode;
				totalInput = draft.totalInput;
				unit = draft.unit;
				emailReceipt = draft.emailReceipt;
				submissionId = draft.submissionId || crypto.randomUUID();
			}
		} catch {
			/* Ignore an invalid local draft. */
		}
		draftReady = true;
	});
	$effect(() => {
		if (draftReady) {
			localStorage.setItem(
				`lunchroom-draft-${actor}`,
				JSON.stringify({
					description,
					date,
					selected,
					amounts,
					descriptions,
					notes,
					mode,
					totalInput,
					unit,
					emailReceipt,
					submissionId
				})
			);
			lastSaved = 'Bản nháp đã lưu trên thiết bị';
		}
	});
	function toggleMember(id: string) {
		selected = selected.includes(id) ? selected.filter((v) => v !== id) : [...selected, id];
	}
	function changeUnit(next: number) {
		const factor = unit / next;
		amounts = Object.fromEntries(Object.entries(amounts).map(([id, value]) => [id, value * factor]));
		totalInput *= factor;
		unit = next;
	}
	function review() {
		validation = '';
		if (!description.trim()) validation = 'Hãy đặt tên cho hóa đơn.';
		else if (!date || Number.isNaN(new Date(date).getTime())) validation = 'Hãy chọn ngày hợp lệ.';
		else if (!lines.length || lines.some((l) => !Number.isSafeInteger(l.amount) || l.amount <= 0))
			validation = 'Mỗi người được chọn cần có số tiền lớn hơn 0.';
		else if (total > 1_000_000_000) validation = 'Tổng hóa đơn tối đa là 1 tỷ đồng.';
		else confirmOpen = true;
	}
	async function submit() {
		try {
			await run(
				'createBill',
				{
					id: submissionId,
					description,
					date: new Date(`${date}T12:00:00+07:00`).toISOString(),
					lines,
					emailReceipt
				},
				'Đã ghi hóa đơn và cập nhật nợ.'
			);
			localStorage.removeItem(`lunchroom-draft-${actor}`);
			draftReady = false;
			confirmOpen = false;
			await goto('/activity');
		} catch {
			/* Preserve draft and submission ID for a safe retry. */
		}
	}
</script>

<a href="/" class="back-link"><ArrowLeft size={16} /> Về tổng quan</a>
<div class="page-heading">
	<div>
		<h1>Tạo hóa đơn</h1>
		<p>Ghi khoản chi và phân bổ nợ.</p>
	</div>
	<span class="draft-status"><Save size={15} />{lastSaved}</span>
</div>
<div class="composer-layout">
	<div class="composer-main">
		<section class="panel form-panel">
			<div class="section-step">
				<span>1</span>
				<h2>Thông tin hóa đơn</h2>
			</div>
			<label class="field"
				>Tên hóa đơn<Input
					placeholder="Ví dụ: Cơm trưa thứ hai, cà phê chiều…"
					bind:value={description}
					maxlength={300}
				/></label
			>
			<div class="form-two-columns">
				<label class="field">Ngày thanh toán<Input type="date" bind:value={date} /></label>
				<div class="field">
					Người đã thanh toán
					<div class="payer-field">
						<Avatar member={payer} size="small" /><strong>{payer.name}</strong><span>Bạn</span>
					</div>
				</div>
			</div>
		</section>
		<section class="panel form-panel">
			<div class="section-step">
				<span>2</span>
				<h2>Thành viên tham gia</h2>
				<button
					class="text-link"
					onclick={() => (selected = selected.length === people.length ? [] : people.map((m) => m.id))}
					>{selected.length === people.length ? 'Bỏ chọn tất cả' : 'Chọn cả nhóm'}</button
				>
			</div>
			<div class="member-picker">
				{#each people as member}<button
						class:selected={selected.includes(member.id)}
						onclick={() => toggleMember(member.id)}
						><Avatar {member} size="small" />{member.name}<span class="pick-check"
							>{#if selected.includes(member.id)}<Check size={12} />{:else}<Plus size={12} />{/if}</span
						></button
					>{/each}
			</div>
		</section>
		<section class="panel form-panel">
			<div class="section-step">
				<span>3</span>
				<h2>Chia hóa đơn</h2>
			</div>
			<div class="split-controls">
				<div class="segmented-control">
					<button class:active={mode === 'manual'} onclick={() => (mode = 'manual')}>Nhập từng người</button
					><button class:active={mode === 'equal'} onclick={() => (mode = 'equal')}>Chia đều</button>
				</div>
				<label class="unit-control"
					>Đơn vị <select value={unit} onchange={(event) => changeUnit(Number(event.currentTarget.value))}
						><option value={1000}>Nghìn đồng (k₫)</option><option value={1}>Đồng (₫)</option></select
					></label
				>
			</div>
			{#if mode === 'equal'}<label class="field total-entry"
					>Tổng tiền cần chia ({unit === 1000 ? 'nghìn đồng' : 'đồng'})<Input
						type="number"
						min="0"
						step={unit === 1000 ? '0.001' : '1'}
						bind:value={totalInput}
					/><small>Phần dư được chia theo từng đồng, tổng tiền luôn khớp.</small></label
				>{/if}
			<div class="participant-lines">
				{#each selected as id, i}{@const person = people.find((m) => m.id === id)!}
					<div class="participant-line">
						<div class="participant-top">
							<Avatar member={person} size="small" /><strong>{person.name}</strong>{#if id === actor}<span
									class="mini-pill">Phần của bạn</span
								>{/if}
							<div class="amount-input">
								{#if mode === 'manual'}<Input
										type="number"
										aria-label={`Số tiền của ${person.name}`}
										min="0"
										step={unit === 1000 ? '0.001' : '1'}
										placeholder="0"
										bind:value={amounts[id]}
									/><span>{unit === 1000 ? 'k₫' : '₫'}</span>{:else}<strong>{currency(split[i])}</strong>{/if}
							</div>
						</div>
						<div class="participant-details">
							<Input
								aria-label={`Món riêng của ${person.name}`}
								placeholder="Món riêng (không bắt buộc)"
								bind:value={descriptions[id]}
								maxlength={300}
							/><Input
								aria-label={`Ghi chú của ${person.name}`}
								placeholder="Ghi chú, ví dụ: ít cay"
								bind:value={notes[id]}
								maxlength={500}
							/>
						</div>
					</div>{/each}{#if !selected.length}<p class="inline-empty">
						Chọn ít nhất một thành viên để chia hóa đơn.
					</p>{/if}
			</div>
		</section>
	</div>
	<div class="composer-side">
		<section class="panel bill-summary">
			<span class="summary-icon"><ReceiptText size={27} /></span>
			<h2>Tóm tắt hóa đơn</h2>
			<p>{description || 'Chưa có mô tả'}</p>
			<div class="summary-pair"><span>Người tham gia</span><strong>{selected.length} người</strong></div>
			<div class="summary-pair">
				<span>Phương thức</span><strong>{mode === 'equal' ? 'Chia đều' : 'Theo từng người'}</strong>
			</div>
			<div class="summary-total"><span>Tổng hóa đơn</span><strong>{currency(total)}</strong></div>
			<div class="receipt-toggle">
				<div><Mail size={17} /><strong>Tạo biên nhận email</strong></div>
				<Switch aria-label="Tạo biên nhận email" bind:checked={emailReceipt} />
			</div>
			<p class="fine-print">
				Biên nhận chung gồm đầy đủ thành viên và món ăn. Chỉ mô phỏng trong bản dùng thử.
			</p>
			{#if validation}<p class="validation-error" role="alert">{validation}</p>{/if}<Button
				class="full-width"
				onclick={review}
				disabled={busy}>Xem lại hóa đơn <ArrowRight size={16} /></Button
			>
			<div class="summary-hint">
				<Info size={15} /><span>Chưa phát sinh nợ cho đến khi bạn xác nhận.</span>
			</div>
		</section>
		<div class="quiet-tip">
			<Info size={19} />
			<p>Phần ăn của bạn được tính vào tổng hóa đơn, không tạo nợ với chính mình.</p>
		</div>
	</div>
</div>
<Modal
	bind:open={confirmOpen}
	title="Kiểm tra trước khi ghi hóa đơn"
	description="Nợ sẽ được cập nhật cho các thành viên dưới đây."
	wide
	><div class="confirm-bill-title">
		<ReceiptText size={23} />
		<h3>{description}</h3>
	</div>
	<div class="review-lines">
		{#each lines as line}<div>
				<span
					><strong>{appState.members.find((m) => m.id === line.memberId)?.name}</strong><small
						>{line.description}{line.note ? ` · ${line.note}` : ''}</small
					></span
				><strong>{currency(line.amount)}</strong>
			</div>{/each}
	</div>
	<div class="summary-total"><span>Tổng cộng</span><strong>{currency(total)}</strong></div>
	<p class="fine-print">
		Người thanh toán: {payer.name}. {emailReceipt
			? 'Tạo một biên nhận chung cho tất cả người tham gia.'
			: 'Không tạo biên nhận email.'}
	</p>
	<div class="modal-actions">
		<Button variant="outline" onclick={() => (confirmOpen = false)} disabled={busy}>Chỉnh sửa</Button><Button
			onclick={submit}
			disabled={busy}><Check size={16} />{busy ? 'Đang ghi…' : 'Xác nhận ghi hóa đơn'}</Button
		>
	</div></Modal
>
