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
	import DiscordPreview from '../DiscordPreview.svelte';
	import { billNotificationMessage } from '$lib/domain/notifications';
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
		groupName,
		discordNotificationPreference,
		onDiscordNotificationPreferenceChange,
		aiEnabled = false
	}: {
		appState: AppState;
		actor: string;
		run: RunCommand;
		busy: boolean;
		groupId: string;
		groupName: string;
		discordNotificationPreference: boolean;
		onDiscordNotificationPreferenceChange: (enabled: boolean) => Promise<void>;
		aiEnabled?: boolean;
	} = $props();
	let description = $state('');
	let date = $state(localDate(new Date()));
	let selected = $state<string[]>([]);
	let payerId = $state('');
	let amounts = $state<Record<string, number>>({});
	let descriptions = $state<Record<string, string>>({});
	let mode = $state('manual');
	let totalInput = $state<number | null>(null);
	let discountInput = $state<number | null>(null);
	let rounding = $state(DEFAULT_ROUNDING);
	let unit = $state(1000);
	let discordNotification = $state(true);
	let savingNotificationPreference = $state(false);
	let notificationPreferenceError = $state('');
	let alreadyPaid = $state(false);
	let confirmOpen = $state(false);
	let previewOpen = $state(false);
	let previewRecipient = $state('');
	let attempted = $state(false);
	let validation = $state('');
	let draftReady = $state(false);
	let submissionId = $state(crypto.randomUUID());
	let imageId = $state('');
	let uploadingImage = $state(false);
	let scanning = $state(false);
	let imageError = $state('');
	let scanNotice = $state('');
	let scannedImageId = $state('');
	let aiChanges = $state({ name: false, date: false, total: false });
	const scanComplete = $derived(!!imageId && scannedImageId === imageId);
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
				? discountShares(listed, discounted, rounding)
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
	const roundingExtra = $derived(
		mode === 'equal'
			? Math.max(0, total - toDong(totalInput))
			: hasDiscount
				? Math.max(0, total - discounted)
				: 0
	);
	const editor = $derived(appState.members.find((member) => member.id === actor)!);
	const isAdmin = $derived(editor.active && editor.role === 'admin');
	const payer = $derived((isAdmin && people.find((member) => member.id === payerId)) || editor);
	const previewMessage = $derived(
		previewOpen && lines.some((line) => line.memberId === previewRecipient)
			? billNotificationMessage(
					{
						id: submissionId,
						organizer: payer.id,
						creator: actor,
						description,
						date,
						lines,
						total,
						discordNotification,
						alreadyPaid,
						memberNames: Object.fromEntries(appState.members.map((member) => [member.id, member.name]))
					},
					{ id: groupId, name: groupName },
					previewRecipient,
					window.location.origin,
					imageId ? `hoa-don.${imageId.split('.').pop()}` : undefined
				)
			: null
	);
	const nameInvalid = $derived(attempted && !description.trim());
	const dateInvalid = $derived(!date || Number.isNaN(new Date(date).getTime()));
	const totalInvalid = $derived(
		mode === 'equal' && (Number(totalInput) < 0 || (attempted && toDong(totalInput) <= 0))
	);
	const discountInvalid = $derived(
		mode === 'manual' &&
			(Number(discountInput) < 0 ||
				(hasDiscount && listed.every((price) => price > 0) && shares.some((s) => s <= 0)))
	);
	const amountInvalid = (id: string, index: number) =>
		mode === 'manual' &&
		(Number(amounts[id]) < 0 || ((attempted || hasDiscount) && (listed[index] <= 0 || shares[index] <= 0)));
	const formatStep = (digits: number) => currency(10 ** digits);
	$effect(() => {
		if (!savingNotificationPreference) discordNotification = discordNotificationPreference;
	});
	onMount(() => {
		selected = [actor];
		payerId = actor;
		discordNotification = discordNotificationPreference;
		try {
			const saved = localStorage.getItem(`lunchroom-draft-${groupId}-${actor}`);
			if (saved) {
				const draft = JSON.parse(saved);
				description = draft.description ?? '';
				date = draft.date ?? date;
				selected = (draft.selected ?? [actor]).filter((id: string) => people.some((m) => m.id === id));
				if (isAdmin && people.some((member) => member.id === draft.payerId)) payerId = draft.payerId;
				amounts = draft.amounts ?? {};
				descriptions = draft.descriptions ?? {};
				mode = draft.mode ?? 'manual';
				totalInput = draft.totalInput ?? null;
				discountInput = draft.discountInput ?? null;
				rounding = draft.rounding ?? DEFAULT_ROUNDING;
				unit = draft.unit ?? 1000;
				alreadyPaid = draft.alreadyPaid === true;
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
					payerId: payer.id,
					amounts,
					descriptions,
					mode,
					totalInput,
					discountInput,
					rounding,
					unit,
					alreadyPaid,
					imageId,
					submissionId
				})
			);
	});
	function toggleMember(id: string) {
		selected = selected.includes(id) ? selected.filter((v) => v !== id) : [...selected, id];
	}
	function changeMode(next: 'manual' | 'equal') {
		if (next === mode) return;
		// Both fields describe the final bill price, before per-person rounding.
		if (next === 'manual') discountInput = totalInput;
		else if (discountInput !== null) totalInput = discountInput;
		mode = next;
	}
	async function changeNotificationPreference(enabled: boolean) {
		if (savingNotificationPreference || busy) return;
		const previous = discordNotification;
		discordNotification = enabled;
		savingNotificationPreference = true;
		notificationPreferenceError = '';
		try {
			await onDiscordNotificationPreferenceChange(enabled);
		} catch {
			discordNotification = previous;
			notificationPreferenceError = 'Không lưu được tùy chọn Discord. Vui lòng thử lại.';
		} finally {
			savingNotificationPreference = false;
		}
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
			scannedImageId = '';
			aiChanges = { name: false, date: false, total: false };
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
	export function isProcessingImage() {
		return imageBusy;
	}
	/** The mobile camera shortcut uses the same upload, draft and optional AI scan flow. */
	export async function attachCapturedPhoto(file: File) {
		if (imageBusy) throw new Error('Đang xử lý ảnh hóa đơn. Vui lòng thử lại sau.');
		const uploaded = await upload(file);
		if (uploaded && aiEnabled) await scanAttachedImage();
	}
	/** A newly selected photo shares the same scan action as an existing attachment. */
	async function scanImage(event: Event) {
		const file = pickedFile(event);
		if (!file) return;
		const uploaded = await upload(file);
		if (!uploaded) return;
		await scanAttachedImage();
	}
	async function scanAttachedImage() {
		if (!imageId || imageBusy || scanComplete) return;
		const uploaded = imageId;
		imageError = '';
		scanning = true;
		try {
			const scan = await scanBillImage(groupId, uploaded);
			aiChanges = {
				name: description !== scan.billName.slice(0, 300),
				date: scan.billDate !== null && date !== scan.billDate,
				total: scan.totalCost > 0 && (mode !== 'equal' || toDong(totalInput) !== scan.totalCost)
			};
			description = scan.billName.slice(0, 300);
			if (scan.billDate !== null) date = scan.billDate;
			mode = 'equal';
			if (scan.totalCost > 0) {
				totalInput = scan.totalCost / unit;
				scanNotice = `AI đã điền tên và tổng ${currency(scan.totalCost)}. Hãy kiểm tra lại.`;
			} else scanNotice = 'AI đã điền tên nhưng không đọc được tổng tiền. Hãy nhập tổng.';
			scannedImageId = uploaded;
		} catch (cause) {
			imageError = (cause as Error).message || 'AI không đọc được hóa đơn.';
		} finally {
			scanning = false;
		}
	}
	function review() {
		if (savingNotificationPreference) return;
		attempted = true;
		validation = '';
		if (!description.trim()) validation = 'Hãy đặt tên cho hóa đơn.';
		else if (dateInvalid) validation = 'Hãy chọn ngày hợp lệ.';
		else if (!lines.length) validation = 'Chọn ít nhất một thành viên.';
		else if (totalInvalid) validation = 'Hãy nhập tổng tiền cần chia.';
		else if (mode === 'manual' && listed.some((price) => price <= 0))
			validation = 'Mỗi người được chọn cần có số tiền lớn hơn 0.';
		else if (discountInvalid) validation = 'Giá sau khi giảm giá không hợp lệ.';
		else if (lines.some((l) => !Number.isSafeInteger(l.amount) || l.amount <= 0))
			validation = 'Mỗi người được chọn cần có số tiền lớn hơn 0.';
		else if (total > 1_000_000_000) validation = 'Tổng hóa đơn tối đa là 1 tỷ đồng.';
		else confirmOpen = true;
	}
	async function submit() {
		if (savingNotificationPreference) return;
		try {
			await run(
				'createBill',
				{
					id: submissionId,
					description,
					date: new Date(`${date}T12:00:00+07:00`).toISOString(),
					lines,
					payerId: payer.id,
					discordNotification,
					alreadyPaid,
					...(imageId ? { image: imageId } : {})
				},
				alreadyPaid
					? 'Đã lưu hóa đơn đã thanh toán; số dư nợ không thay đổi.'
					: 'Đã ghi hóa đơn và cập nhật nợ.'
			);
			localStorage.removeItem(`lunchroom-draft-${groupId}-${actor}`);
			draftReady = false;
			confirmOpen = false;
			await goto('/activity', { replace: true });
		} catch {
			/* Preserve draft and submission ID for a safe retry. */
		}
	}
</script>

<a href="/overview" class="back-link"><ArrowLeft size={16} /> Về tổng quan</a>
<div class="page-heading">
	<div>
		<h1>Tạo hoá đơn</h1>
	</div>
</div>
<div class="composer-layout">
	<div class="composer-main">
		<section class="panel form-panel bill-details-panel" aria-label="Thông tin hóa đơn và thành viên">
			<div class="form-two-columns">
				<label class="field" class:ai-updated={aiChanges.date}
					>Ngày thanh toán<BillDateInput bind:value={date} invalid={dateInvalid} /></label
				>
				{#if isAdmin}<label class="field"
						>Người thanh toán
						<select
							aria-label="Người thanh toán"
							value={payer.id}
							disabled={busy}
							onchange={(event) => (payerId = event.currentTarget.value)}
						>
							{#each people as member}<option value={member.id}
									>{member.name}{member.id === actor ? ' (Bạn)' : ''}</option
								>{/each}
						</select>
					</label>{:else}<div class="field">
						Người thanh toán
						<div class="payer-field">
							<Avatar member={payer} size="small" /><strong>{payer.name}</strong><span>Bạn</span>
						</div>
					</div>{/if}
			</div>
			<label class="field" class:ai-updated={aiChanges.name}
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
					{#if aiEnabled && imageId}
						<button
							type="button"
							class="bill-image-picker ai-scan-picker"
							class:ai-scan-complete={scanComplete}
							disabled={imageBusy || scanComplete}
							onclick={scanAttachedImage}
						>
							{#if scanning}<LoaderCircle class="spin" size={17} />AI đang đọc…{:else if scanComplete}<Check
									size={17}
								/>AI đã đọc hóa đơn{:else}<Sparkles size={17} />Đọc hóa đơn bằng AI{/if}
						</button>
					{:else if aiEnabled}<label class="bill-image-picker ai-scan-picker" aria-disabled={imageBusy}
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
					<button class:active={mode === 'manual'} onclick={() => changeMode('manual')}
						>Nhập từng người</button
					><button class:active={mode === 'equal'} onclick={() => changeMode('equal')}>Chia đều</button>
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
			<div class="split-totals" class:form-two-columns={mode === 'equal' || hasDiscount}>
				{#if mode === 'equal'}
					<label class="field total-entry" class:ai-updated={aiChanges.total}
						>Tổng tiền cần chia<MoneyInput
							label="Tổng tiền cần chia"
							{unit}
							invalid={totalInvalid}
							bind:value={totalInput}
						/></label
					>
				{:else}<label class="field total-entry"
						><span>Giá sau khi giảm giá <span class="optional-label">(không bắt buộc)</span></span><MoneyInput
							label="Giá sau khi giảm giá"
							{unit}
							invalid={discountInvalid}
							placeholder={listedTotal ? String(listedTotal / unit) : '0'}
							bind:value={discountInput}
						/></label
					>{/if}
				{#if mode === 'equal' || hasDiscount}<label class="field"
						>Làm tròn lên mỗi phần<select bind:value={rounding}
							>{#each ROUNDING_OPTIONS as digits}<option value={digits}
									>{digits === 0 ? 'Không làm tròn' : formatStep(digits)}</option
								>{/each}</select
						></label
					>{/if}
			</div>
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
			<div class="bill-summary-heading">
				<span class="summary-icon"><ReceiptText size={27} /></span>
				<h2>Tóm tắt hóa đơn</h2>
			</div>
			<p class="bill-summary-description" class:placeholder={!description}>
				{description || 'Chưa có mô tả'}
			</p>
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
			<div class="paid-bill-option">
				<div class="receipt-toggle">
					<button type="button" tabindex="-1" onclick={() => (alreadyPaid = !alreadyPaid)}
						><Check size={17} /><strong>Mọi người đã thanh toán</strong></button
					>
					<Switch aria-label="Mọi người đã thanh toán" bind:checked={alreadyPaid} />
				</div>
				<p class="fine-print">Chỉ lưu hóa đơn vào lịch sử, không phát sinh nợ mới.</p>
			</div>
			<div class="receipt-toggle">
				<button
					type="button"
					tabindex="-1"
					disabled={savingNotificationPreference || busy}
					onclick={() => void changeNotificationPreference(!discordNotification)}
					><MessageCircle size={17} /><strong>Gửi thông báo qua Discord</strong></button
				>
				<Switch
					aria-label="Gửi thông báo qua Discord"
					checked={discordNotification}
					onCheckedChange={(enabled) => void changeNotificationPreference(enabled)}
					disabled={savingNotificationPreference || busy}
				/>
			</div>
			{#if notificationPreferenceError}<p class="validation-error" role="alert">
					{notificationPreferenceError}
				</p>{/if}
			{#if validation}<p class="validation-error" role="alert">{validation}</p>{/if}<Button
				class="full-width"
				onclick={review}
				disabled={busy || imageBusy || savingNotificationPreference}
				>Xem lại hóa đơn <ArrowRight size={16} /></Button
			>
		</section>
	</div>
</div>
<Modal bind:open={confirmOpen} title="Xác nhận hóa đơn" wide compact
	><div class="confirm-bill-title">
		<h3>{description}</h3>
		<p>Ăn vào {billDateLabel(date)} · {payer.name} thanh toán</p>
	</div>
	{#if alreadyPaid}<p class="paid-bill-status" role="status">
			<Check size={16} />Mọi người đã thanh toán đầy đủ. Không phát sinh nợ mới.
		</p>{/if}
	{#if imageId && confirmOpen}<div class="bill-detail-image">
			<BillImage {groupId} {imageId} />
		</div>{/if}
	<div class="review-lines bill-detail-lines">
		{#each lines as line}<div>
				<span
					><strong>{appState.members.find((m) => m.id === line.memberId)?.name}</strong><small
						>{line.description}</small
					></span
				><strong>{currency(line.amount)}</strong>
			</div>{/each}
	</div>
	<div class="summary-total"><span>Tổng cộng</span><strong>{currency(total)}</strong></div>
	<div class="modal-actions">
		{#if discordNotification}<Button
				variant="outline"
				disabled={busy}
				onclick={() => {
					previewRecipient = selected.find((id) => id !== payer.id) ?? selected[0];
					previewOpen = true;
				}}
			>
				<MessageCircle size={16} />Xem trước Discord</Button
			>{/if}
		<Button onclick={submit} disabled={busy}><Check size={16} />{busy ? 'Đang ghi…' : 'Xác nhận'}</Button>
	</div></Modal
>
<Modal bind:open={previewOpen} title="Xem trước Discord" wide>
	<label class="field"
		>Người nhận<select bind:value={previewRecipient}
			>{#each lines as line}<option value={line.memberId}
					>{appState.members.find((member) => member.id === line.memberId)?.name}</option
				>{/each}</select
		></label
	>
	{#if previewMessage}<DiscordPreview message={previewMessage} {groupId} {imageId} />{/if}
</Modal>
