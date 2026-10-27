<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import {
		Plus,
		ArrowLeft,
		ArrowRight,
		Check,
		MessageCircle,
		ReceiptText,
		ImagePlus,
		LoaderCircle,
		Sparkles,
		X
	} from '@lucide/svelte';
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import { Switch } from '$lib/components/ui/switch';
	import Modal from '../Modal.svelte';
	import Avatar from '../Avatar.svelte';
	import MoneyInput from '../MoneyInput.svelte';
	import BillDateInput from '../BillDateInput.svelte';
	import BillImage from '../BillImage.svelte';
	import { scanBillImage, uploadBillImage } from '$lib/client/api';
	import { compressImage } from '$lib/client/images';
	import type { AppState, BillLine } from '$lib/domain/types';
	import type { RunCommand } from '$lib/client/types';
	import { currency, billDateLabel, discountShares, equalShares, localDate } from '$lib/domain/ledger';
	const ROUNDING_OPTIONS = [0, 1, 2, 3, 4];
	const DEFAULT_ROUNDING = 3;
	let {
		appState,
		actor,
		run,
		busy,
		groupId,
		aiEnabled = false
	}: {
		appState: AppState;
		actor: string;
		run: RunCommand;
		busy: boolean;
		groupId: string;
		aiEnabled?: boolean;
	} = $props();
	let description = $state('');
	let date = $state(localDate(new Date()));
	let selected = $state<string[]>([]);
	let amounts = $state<Record<string, number>>({});
	let descriptions = $state<Record<string, string>>({});
	let mode = $state('manual');
	let totalInput = $state<number | null>(null);
	let discountInput = $state<number | null>(null);
	let rounding = $state(DEFAULT_ROUNDING);
	let unit = $state(1000);
	let discordNotification = $state(true);
	let confirmOpen = $state(false);
	let attempted = $state(false);
	let validation = $state('');
	let draftReady = $state(false);
	let submissionId = $state(crypto.randomUUID());
	let imageId = $state('');
	let uploadingImage = $state(false);
	let scanning = $state(false);
	let imageError = $state('');
	let scanNotice = $state('');
	const imageBusy = $derived(uploadingImage || scanning);
	const people = $derived(appState.members.filter((m) => m.active));
	const toDong = (value: number | null | undefined) => Math.round((Number(value) || 0) * unit);
	const listed = $derived(selected.map((id) => toDong(amounts[id])));
	const listedTotal = $derived(listed.reduce((s, v) => s + v, 0));
	const discounted = $derived(toDong(discountInput));
	const hasDiscount = $derived(mode === 'manual' && discounted > 0);
	const shares = $derived(
		mode === 'equal'
			? equalShares(toDong(totalInput), selected.length, rounding)
			: hasDiscount
				? discountShares(listed, discounted)
				: listed
	);
	const lines = $derived<BillLine[]>(
		selected.map((memberId, i) => ({
			memberId,
			amount: shares[i] ?? 0,
			description: descriptions[memberId] || description,
			note: ''
		}))
	);
	const total = $derived(lines.reduce((s, l) => s + l.amount, 0));
	const roundingExtra = $derived(mode === 'equal' ? Math.max(0, total - toDong(totalInput)) : 0);
	const payer = $derived(appState.members.find((m) => m.id === actor)!);
	const nameInvalid = $derived(attempted && !description.trim());
	const dateInvalid = $derived(!date || Number.isNaN(new Date(date).getTime()));
	const totalInvalid = $derived(
		mode === 'equal' && (Number(totalInput) < 0 || (attempted && toDong(totalInput) <= 0))
	);
	const discountInvalid = $derived(
		mode === 'manual' && (Number(discountInput) < 0 || (hasDiscount && shares.some((s) => s <= 0)))
	);
	const amountInvalid = (id: string, index: number) =>
		mode === 'manual' &&
		(Number(amounts[id]) < 0 || (attempted && (listed[index] <= 0 || shares[index] <= 0)));
	const formatStep = (digits: number) => currency(10 ** digits);
	onMount(() => {
		selected = [actor];
		try {
			const saved = localStorage.getItem(`lunchroom-draft-${groupId}-${actor}`);
			if (saved) {
				const draft = JSON.parse(saved);
				description = draft.description ?? '';
				date = draft.date ?? date;
				selected = (draft.selected ?? [actor]).filter((id: string) => people.some((m) => m.id === id));
				amounts = draft.amounts ?? {};
				descriptions = draft.descriptions ?? {};
				mode = draft.mode ?? 'manual';
				totalInput = draft.totalInput ?? null;
				discountInput = draft.discountInput ?? null;
				rounding = draft.rounding ?? DEFAULT_ROUNDING;
				unit = draft.unit ?? 1000;
				discordNotification = draft.discordNotification ?? true;
				imageId = draft.imageId ?? '';
				submissionId = draft.submissionId || crypto.randomUUID();
			}
		} catch {
			/* Ignore an invalid local draft. */
		}
		// The spending calendar links here with the day the user picked.
		const requestedDate = page.url.searchParams.get('date');
		if (requestedDate && /^\d{4}-\d{2}-\d{2}$/.test(requestedDate)) date = requestedDate;
		draftReady = true;
	});
	$effect(() => {
		if (draftReady)
			localStorage.setItem(
				`lunchroom-draft-${groupId}-${actor}`,
				JSON.stringify({
					description,
					date,
					selected,
					amounts,
					descriptions,
					mode,
					totalInput,
					discountInput,
					rounding,
					unit,
					discordNotification,
					imageId,
					submissionId
				})
			);
	});
	function toggleMember(id: string) {
		selected = selected.includes(id) ? selected.filter((v) => v !== id) : [...selected, id];
	}
	function changeUnit(next: number) {
		const factor = unit / next;
		amounts = Object.fromEntries(Object.entries(amounts).map(([id, value]) => [id, value * factor]));
		if (totalInput) totalInput *= factor;
		if (discountInput) discountInput *= factor;
		unit = next;
	}
	function pickedFile(event: Event) {
		const input = event.currentTarget as HTMLInputElement;
		const file = input.files?.[0];
		input.value = '';
		return file;
	}
	/** Uploads as soon as a photo is picked so the draft can keep the stored id across reloads. */
	async function upload(file: File) {
		imageError = '';
		scanNotice = '';
		uploadingImage = true;
		try {
			imageId = await uploadBillImage(groupId, await compressImage(file));
			return imageId;
		} catch (cause) {
			imageError = (cause as Error).message || 'Không tải được ảnh lên.';
		} finally {
			uploadingImage = false;
		}
	}
	async function attachImage(event: Event) {
		const file = pickedFile(event);
		if (file) await upload(file);
	}
	/** Attaches the photo, then fills the name and an equal split of the total read by the AI. */
	async function scanImage(event: Event) {
		const file = pickedFile(event);
		if (!file) return;
		const uploaded = await upload(file);
		if (!uploaded) return;
		scanning = true;
		try {
			const scan = await scanBillImage(groupId, uploaded);
			description = scan.billName.slice(0, 300);
			mode = 'equal';
			if (scan.totalCost > 0) {
				totalInput = scan.totalCost / unit;
				scanNotice = `AI đã điền tên và tổng ${currency(scan.totalCost)}. Hãy kiểm tra lại.`;
			} else scanNotice = 'AI đã điền tên nhưng không đọc được tổng tiền. Hãy nhập tổng.';
		} catch (cause) {
			imageError = (cause as Error).message || 'AI không đọc được hóa đơn.';
		} finally {
			scanning = false;
		}
	}
	function review() {
		attempted = true;
		validation = '';
		if (!description.trim()) validation = 'Hãy đặt tên cho hóa đơn.';
		else if (dateInvalid) validation = 'Hãy chọn ngày hợp lệ.';
		else if (!lines.length) validation = 'Chọn ít nhất một thành viên.';
		else if (totalInvalid) validation = 'Hãy nhập tổng tiền cần chia.';
		else if (discountInvalid) validation = 'Giá sau khi giảm giá không hợp lệ.';
		else if (lines.some((l) => !Number.isSafeInteger(l.amount) || l.amount <= 0))
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
					discordNotification,
					...(imageId ? { image: imageId } : {})
				},
				'Đã ghi hóa đơn và cập nhật nợ.'
			);
			localStorage.removeItem(`lunchroom-draft-${groupId}-${actor}`);
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
		<h1>Tạo hoá đơn</h1>
	</div>
</div>
<div class="composer-layout">
	<div class="composer-main">
		<section class="panel form-panel bill-details-panel" aria-label="Thông tin hóa đơn và thành viên">
			<div class="form-two-columns">
				<label class="field">Ngày thanh toán<BillDateInput bind:value={date} invalid={dateInvalid} /></label>
				<div class="field">
					Người đã thanh toán
					<div class="payer-field">
						<Avatar member={payer} size="small" /><strong>{payer.name}</strong><span>Bạn</span>
					</div>
				</div>
			</div>
			<label class="field"
				>Tên hóa đơn<Input
					placeholder="Ví dụ: Cơm trưa thứ hai, cà phê chiều…"
					bind:value={description}
					aria-invalid={nameInvalid}
					maxlength={300}
				/></label
			>
			<div class="field">
				<span>Ảnh hóa đơn <span class="optional-label">(không bắt buộc)</span></span>
				<div class="bill-image-field">
					{#if imageId}<div class="bill-image-attached">
							<BillImage {groupId} {imageId} /><button
								type="button"
								class="bill-image-remove"
								aria-label="Bỏ ảnh hóa đơn"
								disabled={imageBusy}
								onclick={() => (imageId = '')}><X size={14} /></button
							>
						</div>{/if}
					<label class="bill-image-picker" aria-disabled={imageBusy}
						>{#if uploadingImage && !scanning}<LoaderCircle class="spin" size={17} />Đang tải ảnh…{:else}<ImagePlus
								size={17}
							/>{imageId ? 'Đổi ảnh' : 'Đính kèm ảnh'}{/if}<input
							type="file"
							accept="image/*"
							aria-label="Chọn ảnh hóa đơn"
							disabled={imageBusy}
							onchange={attachImage}
						/></label
					>
					{#if aiEnabled}<label class="bill-image-picker ai-scan-picker" aria-disabled={imageBusy}
							>{#if scanning}<LoaderCircle class="spin" size={17} />AI đang đọc…{:else}<Sparkles
									size={17}
								/>Đọc hóa đơn bằng AI{/if}<input
								type="file"
								accept="image/*"
								aria-label="Chọn ảnh để AI đọc hóa đơn"
								disabled={imageBusy}
								onchange={scanImage}
							/></label
						>{/if}
				</div>
				{#if imageError}<small class="validation-error" role="alert">{imageError}</small>{/if}
				{#if scanNotice}<small class="ai-scan-notice" role="status">{scanNotice}</small>{/if}
			</div>
			<div class="section-step participant-picker-heading">
				<h2>Thành viên tham gia</h2>
				<button
					class="text-link"
					onclick={() => (selected = selected.length === people.length ? [] : people.map((m) => m.id))}
					>{selected.length === people.length ? 'Bỏ chọn tất cả' : 'Chọn tất cả'}</button
				>
			</div>
			<div class="member-picker" class:invalid-group={attempted && !selected.length}>
				{#each people as member}<button
						class:selected={selected.includes(member.id)}
						aria-pressed={selected.includes(member.id)}
						onclick={() => toggleMember(member.id)}
						><Avatar {member} size="small" />{member.name}<span class="pick-check"
							>{#if selected.includes(member.id)}<Check size={12} />{:else}<Plus size={12} />{/if}</span
						></button
					>{/each}
			</div>
		</section>
		<section class="panel form-panel">
			<div class="section-step">
				<h2>Chia hóa đơn</h2>
			</div>
			<div class="split-controls">
				<div class="segmented-control">
					<button class:active={mode === 'manual'} onclick={() => (mode = 'manual')}>Nhập từng người</button
					><button class:active={mode === 'equal'} onclick={() => (mode = 'equal')}>Chia đều</button>
				</div>
				<label class="unit-control"
					>Đơn vị <select
						aria-label="Đơn vị"
						value={unit}
						onchange={(event) => changeUnit(Number(event.currentTarget.value))}
						><option value={1000}>Nghìn đồng</option><option value={1}>Đồng</option></select
					></label
				>
			</div>
			{#if mode === 'equal'}<div class="form-two-columns split-totals">
					<label class="field total-entry"
						>Tổng tiền cần chia<MoneyInput
							label="Tổng tiền cần chia"
							{unit}
							invalid={totalInvalid}
							bind:value={totalInput}
						/></label
					>
					<label class="field"
						>Làm tròn lên mỗi phần<select bind:value={rounding}
							>{#each ROUNDING_OPTIONS as digits}<option value={digits}
									>{digits === 0 ? 'Không làm tròn' : formatStep(digits)}</option
								>{/each}</select
						></label
					>
				</div>{:else}<label class="field total-entry"
					><span>Giá sau khi giảm giá <span class="optional-label">(không bắt buộc)</span></span><MoneyInput
						label="Giá sau khi giảm giá"
						{unit}
						invalid={discountInvalid}
						placeholder={listedTotal ? String(listedTotal / unit) : '0'}
						bind:value={discountInput}
					/></label
				>{/if}
			<div class="participant-lines">
				{#each selected as id, i}{@const person = people.find((m) => m.id === id)!}
					<div class="participant-line participant-split-row">
						<div class="participant-name">
							<Avatar member={person} size="small" /><strong>{person.name}</strong>{#if id === actor}<span
									class="mini-pill">Phần của bạn</span
								>{/if}
						</div>
						<div class="amount-input">
							{#if mode === 'manual'}<MoneyInput
									label={`Số tiền của ${person.name}`}
									{unit}
									invalid={amountInvalid(id, i)}
									bind:value={amounts[id]}
								/>{#if hasDiscount}<span class="discounted-share">→ {currency(shares[i] ?? 0)}</span
									>{/if}{:else}<strong>{currency(shares[i] ?? 0)}</strong>{/if}
						</div>
						<div class="participant-food">
							<Input
								aria-label={`Món ăn của ${person.name}`}
								placeholder="Món ăn (không bắt buộc)"
								bind:value={descriptions[id]}
								maxlength={300}
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
			{#if hasDiscount}<div class="summary-pair">
					<span>Giá gốc</span><strong>{currency(listedTotal)}</strong>
				</div>{/if}
			{#if roundingExtra}<div class="summary-pair">
					<span>Làm tròn</span><strong>+{currency(roundingExtra)}</strong>
				</div>{/if}
			<div class="summary-total"><span>Tổng hóa đơn</span><strong>{currency(total)}</strong></div>
			<div class="receipt-toggle">
				<button type="button" tabindex="-1" onclick={() => (discordNotification = !discordNotification)}
					><MessageCircle size={17} /><strong>Gửi thông báo qua Discord</strong></button
				>
				<Switch aria-label="Gửi thông báo qua Discord" bind:checked={discordNotification} />
			</div>
			{#if validation}<p class="validation-error" role="alert">{validation}</p>{/if}<Button
				class="full-width"
				onclick={review}
				disabled={busy || imageBusy}>Xem lại hóa đơn <ArrowRight size={16} /></Button
			>
		</section>
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
						>{line.description}</small
					></span
				><strong>{currency(line.amount)}</strong>
			</div>{/each}
	</div>
	<div class="summary-total"><span>Tổng cộng</span><strong>{currency(total)}</strong></div>
	<p class="fine-print">
		Người thanh toán: {payer.name} · {billDateLabel(date)}.{imageId
			? ' Kèm ảnh hóa đơn.'
			: ''}{discordNotification ? '' : ' Không gửi thông báo Discord.'}
	</p>
	<div class="modal-actions">
		<Button onclick={submit} disabled={busy}><Check size={16} />{busy ? 'Đang ghi…' : 'Xác nhận'}</Button>
	</div></Modal
>
