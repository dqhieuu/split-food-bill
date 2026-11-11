<script lang="ts">
	import { onMount, tick, untrack } from 'svelte';
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import {
		Plus,
		UsersRound,
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
	import {
		applyBillDraftScan,
		billDraftDetails,
		changeBillDraftMode,
		changeBillDraftUnit,
		createBillDraftStorage,
		newBillDraft,
		restoreBillDraft,
		reviewBillDraft,
		reviewedBill,
		ROUNDING_OPTIONS,
		type BillSubmission
	} from '$lib/client/bill-draft';
	import { compressImage } from '$lib/client/images';
	import type { AppState } from '$lib/domain/types';
	import type { RunCommand } from '$lib/client/types';
	import { currency, billDateLabel } from '$lib/domain/ledger';

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

	const draftStorage = $derived(createBillDraftStorage(() => localStorage, groupId, actor));
	let draft = $state(newBillDraft(untrack(() => actor)));
	let draftReady = $state(false);
	let reviewSubmission = $state<BillSubmission | null>(null);
	let pending = $state<BillSubmission | null>(null);
	let submitting = $state(false);
	let submitError = $state('');
	let discordNotification = $state(true);
	let savingNotificationPreference = $state(false);
	let notificationPreferenceError = $state('');
	let confirmOpen = $state(false);
	let previewOpen = $state(false);
	let previewRecipient = $state('');
	let attempted = $state(false);
	let validation = $state('');
	let uploadingImage = $state(false);
	let scanning = $state(false);
	let imageError = $state('');
	let scanNotice = $state('');
	let scannedImageId = $state('');
	let aiChanges = $state({ name: false, date: false, total: false });

	const people = $derived(appState.members.filter((member) => member.active));
	const editor = $derived(appState.members.find((member) => member.id === actor)!);
	const isAdmin = $derived(editor.active && editor.role === 'admin');
	const details = $derived(billDraftDetails(draft, editor, people, attempted));
	const {
		selected,
		payer,
		shares,
		total,
		listedTotal,
		hasDiscount,
		roundingExtra,
		nameInvalid,
		dateInvalid,
		totalInvalid,
		discountInvalid,
		amountInvalid
	} = $derived(details);
	const { mode, unit, imageId } = $derived(draft);
	const scanComplete = $derived(!!imageId && scannedImageId === imageId);
	const imageBusy = $derived(uploadingImage || scanning);
	const submission = $derived(pending ?? reviewSubmission);
	const bill = $derived(submission ? reviewedBill(submission, actor, appState.members) : null);
	const reviewImageId = $derived(submission?.image ?? '');
	const previewMessage = $derived(
		previewOpen && bill?.lines.some((line) => line.memberId === previewRecipient)
			? billNotificationMessage(
					bill,
					{ id: groupId, name: groupName },
					previewRecipient,
					window.location.origin,
					reviewImageId ? `hoa-don.${reviewImageId.split('.').pop()}` : undefined
				)
			: null
	);

	$effect(() => {
		if (!savingNotificationPreference) discordNotification = discordNotificationPreference;
	});
	onMount(() => {
		try {
			draft = restoreBillDraft(draftStorage.read(), draft, editor, people, page.url.searchParams.get('date'));
			pending = draftStorage.readAttempt();
		} catch {
			/* A browser that blocks storage can still show the form. */
		}
		draftReady = true;
	});
	$effect(() => {
		if (!draftReady || pending) return;
		try {
			draftStorage.save({ ...draft, selected, payerId: payer.id });
		} catch {
			/* Submission reports when its retry record cannot be stored. */
		}
	});

	function toggleMember(id: string) {
		draft.selected = selected.includes(id) ? selected.filter((value) => value !== id) : [...selected, id];
	}

	async function changeNotificationPreference(enabled: boolean) {
		if (pending || savingNotificationPreference || busy) return;
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

	function pickedFile(event: Event) {
		const input = event.currentTarget as HTMLInputElement;
		const file = input.files?.[0];
		input.value = '';
		return file;
	}

	/** Upload immediately so the draft can retain the stored image ID across reloads. */
	async function upload(file: File) {
		if (pending || imageBusy || confirmOpen) return;
		imageError = '';
		scanNotice = '';
		uploadingImage = true;
		try {
			draft.imageId = await uploadBillImage(groupId, await compressImage(file));
			scannedImageId = '';
			aiChanges = { name: false, date: false, total: false };
			return draft.imageId;
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
		return imageBusy || !!pending || confirmOpen;
	}

	export async function attachCapturedPhoto(file: File) {
		if (pending) throw new Error('Hãy xác nhận kết quả lưu hóa đơn trước khi đổi ảnh.');
		if (imageBusy || confirmOpen) throw new Error('Đang xử lý hóa đơn. Vui lòng thử lại sau.');
		const uploaded = await upload(file);
		if (uploaded && aiEnabled) await scanAttachedImage();
	}

	async function scanImage(event: Event) {
		const file = pickedFile(event);
		if (file && (await upload(file))) await scanAttachedImage();
	}

	async function scanAttachedImage() {
		if (!imageId || imageBusy || scanComplete || pending || confirmOpen) return;
		const uploaded = imageId;
		imageError = '';
		scanning = true;
		try {
			const scan = await scanBillImage(groupId, uploaded);
			const next = applyBillDraftScan(draft, scan);
			draft = next.draft;
			aiChanges = next.changes;
			scanNotice =
				scan.totalCost > 0
					? `AI đã điền tên và tổng ${currency(scan.totalCost)}. Hãy kiểm tra lại.`
					: 'AI đã điền tên nhưng không đọc được tổng tiền. Hãy nhập tổng.';
			scannedImageId = uploaded;
		} catch (cause) {
			imageError = (cause as Error).message || 'AI không đọc được hóa đơn.';
		} finally {
			scanning = false;
		}
	}

	function review() {
		if (busy || imageBusy || savingNotificationPreference) return;
		submitError = '';
		if (!pending) {
			attempted = true;
			const result = reviewBillDraft(draft, details, discordNotification);
			validation = 'error' in result ? result.error : '';
			if ('error' in result) return;
			reviewSubmission = result.submission;
		}
		confirmOpen = true;
	}

	async function clearSubmittedBill(complete: () => void) {
		draftReady = false;
		draft = newBillDraft(actor);
		imageError = '';
		scanNotice = '';
		scannedImageId = '';
		aiChanges = { name: false, date: false, total: false };
		confirmOpen = false;
		previewOpen = false;
		previewRecipient = '';
		reviewSubmission = null;
		attempted = false;
		validation = '';
		notificationPreferenceError = '';
		await tick();
		try {
			complete();
		} catch {
			/* If cleanup fails, the stored submission can still be replayed safely. */
		}
		pending = null;
		try {
			await goto('/activity', { replace: true });
		} finally {
			draftReady = true;
		}
	}

	async function submit() {
		const reviewed = submission;
		if (!reviewed || submitting || busy || savingNotificationPreference) return;
		submitError = '';
		let attempt: ReturnType<typeof draftStorage.beginAttempt>;
		try {
			attempt = draftStorage.beginAttempt({ ...draft, selected, payerId: payer.id }, reviewed, !!pending);
		} catch {
			submitError = 'Không lưu được thông tin thử lại trên trình duyệt. Vui lòng thử lại.';
			return;
		}
		pending = attempt.submission;
		// If another tab started saving, show its exact submission for review before retrying it.
		if (JSON.stringify(attempt.submission) !== JSON.stringify(reviewed)) return;

		submitting = true;
		try {
			await run(
				'createBill',
				attempt.submission,
				attempt.submission.alreadyPaid
					? 'Đã lưu hóa đơn đã thanh toán; số dư nợ không thay đổi.'
					: 'Đã ghi hóa đơn và cập nhật nợ.'
			);
		} catch (cause) {
			try {
				if (attempt.reject(cause)) {
					pending = null;
					reviewSubmission = null;
					confirmOpen = false;
				}
			} catch {
				submitError = 'Không xóa được thông tin thử lại trên trình duyệt.';
			}
			return;
		} finally {
			submitting = false;
		}
		await clearSubmittedBill(attempt.complete);
	}
</script>

<a href="/overview" class="back-link"><ArrowLeft size={16} /> Về tổng quan</a>
<div class="page-heading">
	<div>
		<h1>Tạo hoá đơn</h1>
	</div>
</div>
<div class="composer-layout">
	<fieldset class="composer-main min-w-0" disabled={!!pending} aria-label="Nội dung hóa đơn">
		<section class="panel form-panel bill-details-panel" aria-label="Thông tin hóa đơn và thành viên">
			<div class="form-two-columns">
				<label class="field" class:ai-updated={aiChanges.date}
					>Ngày thanh toán<BillDateInput bind:value={draft.date} invalid={dateInvalid} /></label
				>
				{#if isAdmin}<label class="field"
						>Người thanh toán
						<select
							aria-label="Người thanh toán"
							value={payer.id}
							disabled={busy}
							onchange={(event) => (draft.payerId = event.currentTarget.value)}
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
					bind:value={draft.description}
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
								onclick={() => (draft.imageId = '')}><X size={14} /></button
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
					onclick={() => (draft.selected = selected.length === people.length ? [] : people.map((m) => m.id))}
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
					<button
						class:active={mode === 'manual'}
						onclick={() => (draft = changeBillDraftMode(draft, 'manual'))}>Nhập từng người</button
					><button
						class:active={mode === 'equal'}
						onclick={() => (draft = changeBillDraftMode(draft, 'equal'))}>Chia đều</button
					>
				</div>
				<div class="unit-control">
					<span>Đơn vị</span>
					<div class="segmented-control" role="group" aria-label="Đơn vị">
						<button
							type="button"
							class:active={unit === 1000}
							aria-pressed={unit === 1000}
							onclick={() => (draft = changeBillDraftUnit(draft, 1000))}>Nghìn đồng</button
						>
						<button
							type="button"
							class:active={unit === 1}
							aria-pressed={unit === 1}
							onclick={() => (draft = changeBillDraftUnit(draft, 1))}>Đồng</button
						>
					</div>
				</div>
			</div>
			<div class="split-totals" class:form-two-columns={mode === 'equal' || hasDiscount}>
				{#if mode === 'equal'}
					<label class="field total-entry" class:ai-updated={aiChanges.total}
						>Tổng tiền cần chia<MoneyInput
							label="Tổng tiền cần chia"
							{unit}
							invalid={totalInvalid}
							bind:value={draft.totalInput}
						/></label
					>
				{:else}<label class="field total-entry"
						><span>Giá sau khi giảm giá <span class="optional-label">(không bắt buộc)</span></span><MoneyInput
							label="Giá sau khi giảm giá"
							{unit}
							invalid={discountInvalid}
							placeholder={listedTotal ? String(listedTotal / unit) : '0'}
							bind:value={draft.discountInput}
						/></label
					>{/if}
				{#if mode === 'equal' || hasDiscount}<label class="field"
						>Làm tròn lên mỗi phần<select bind:value={draft.rounding}
							>{#each ROUNDING_OPTIONS as digits}<option value={digits}
									>{digits === 0 ? 'Không làm tròn' : currency(10 ** digits)}</option
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
									invalid={amountInvalid[i]}
									bind:value={draft.amounts[id]}
								/>{#if hasDiscount}<span class="discounted-share">→ {currency(shares[i] ?? 0)}</span
									>{/if}{:else}<strong>{currency(shares[i] ?? 0)}</strong>{/if}
						</div>
						<div class="participant-food">
							<Input
								aria-label={`Món ăn của ${person.name}`}
								placeholder="Món ăn (không bắt buộc)"
								bind:value={draft.descriptions[id]}
								maxlength={300}
							/>
						</div>
					</div>{/each}{#if !selected.length}<div class="split-empty" role="status">
						<span class="split-empty-icon"><UsersRound size={20} aria-hidden="true" /></span>
						<div>
							<strong>Chưa chọn thành viên</strong>
							<p>Chọn người tham gia ở trên để bắt đầu chia tiền.</p>
						</div>
					</div>{/if}
			</div>
		</section>
	</fieldset>
	<div class="composer-side">
		<section class="panel bill-summary">
			<div class="bill-summary-heading">
				<span class="summary-icon"><ReceiptText size={27} /></span>
				<h2>Tóm tắt hóa đơn</h2>
			</div>
			<p class="bill-summary-description" class:placeholder={!draft.description}>
				{pending?.description ?? (draft.description || 'Chưa có mô tả')}
			</p>
			<div class="summary-pair">
				<span>Người tham gia</span><strong>{pending?.lines.length ?? selected.length} người</strong>
			</div>
			{#if !pending}
				<div class="summary-pair">
					<span>Phương thức</span><strong>{mode === 'equal' ? 'Chia đều' : 'Theo từng người'}</strong>
				</div>
				{#if hasDiscount}<div class="summary-pair">
						<span>Giá gốc</span><strong>{currency(listedTotal)}</strong>
					</div>{/if}
				{#if roundingExtra}<div class="summary-pair">
						<span>Làm tròn</span><strong>+{currency(roundingExtra)}</strong>
					</div>{/if}
			{/if}
			<div class="summary-total">
				<span>Tổng hóa đơn</span><strong>{currency(pending && bill ? bill.total : total)}</strong>
			</div>
			<div class="paid-bill-option">
				<div class="receipt-toggle">
					<button
						type="button"
						tabindex="-1"
						disabled={!!pending}
						onclick={() => (draft.alreadyPaid = !draft.alreadyPaid)}
						><Check size={17} /><strong>Mọi người đã thanh toán</strong></button
					>
					<Switch
						aria-label="Mọi người đã thanh toán"
						checked={pending?.alreadyPaid ?? draft.alreadyPaid}
						onCheckedChange={(checked) => (draft.alreadyPaid = checked)}
						disabled={!!pending}
					/>
				</div>
				<p class="fine-print">Chỉ lưu hóa đơn vào lịch sử, không phát sinh nợ mới.</p>
			</div>
			<div class="receipt-toggle">
				<button
					type="button"
					tabindex="-1"
					disabled={!!pending || savingNotificationPreference || busy}
					onclick={() => void changeNotificationPreference(!discordNotification)}
					><MessageCircle size={17} /><strong>Gửi thông báo qua Discord</strong></button
				>
				<Switch
					aria-label="Gửi thông báo qua Discord"
					checked={pending?.discordNotification ?? discordNotification}
					onCheckedChange={(enabled) => void changeNotificationPreference(enabled)}
					disabled={!!pending || savingNotificationPreference || busy}
				/>
			</div>
			{#if notificationPreferenceError}<p class="validation-error" role="alert">
					{notificationPreferenceError}
				</p>{/if}
			{#if pending && !confirmOpen && !submitting}<p class="fine-print" role="status">
					Chưa xác nhận được lần lưu trước. Xem lại để gửi lại đúng nội dung đã xác nhận.
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
<Modal bind:open={confirmOpen} title="Xác nhận hóa đơn" wide compact locked={submitting}>
	{#if bill}
		<div class="confirm-bill-title">
			<h3>{bill.description}</h3>
			<p>
				Ăn vào {billDateLabel(bill.date)} · {bill.memberNames?.[bill.organizer] ?? bill.organizer} thanh toán
			</p>
		</div>
		{#if bill.alreadyPaid}<p class="paid-bill-status" role="status">
				<Check size={16} />Mọi người đã thanh toán đầy đủ. Không phát sinh nợ mới.
			</p>{/if}
		{#if reviewImageId && confirmOpen}<div class="bill-detail-image">
				<BillImage {groupId} imageId={reviewImageId} />
			</div>{/if}
		<div class="review-lines bill-detail-lines">
			{#each bill.lines as line}<div>
					<span
						><strong>{bill.memberNames?.[line.memberId] ?? line.memberId}</strong><small
							>{line.description}</small
						></span
					>
					<strong>{currency(line.amount)}</strong>
				</div>{/each}
		</div>
		<div class="summary-total"><span>Tổng cộng</span><strong>{currency(bill.total)}</strong></div>
		{#if pending && !submitting}<p class="fine-print" role="status">
				Chưa xác nhận được lần lưu trước. Lần thử lại sẽ gửi đúng nội dung này.
			</p>{/if}
		{#if submitError}<p class="validation-error" role="alert">{submitError}</p>{/if}
		<div class="modal-actions">
			{#if bill.discordNotification}<Button
					variant="outline"
					disabled={busy || submitting}
					onclick={() => {
						previewRecipient =
							bill.lines.find((line) => line.memberId !== bill.organizer)?.memberId ?? bill.lines[0].memberId;
						previewOpen = true;
					}}
				>
					<MessageCircle size={16} />Xem trước Discord</Button
				>{/if}
			<Button onclick={submit} disabled={busy || submitting}>
				<Check size={16} />{busy || submitting ? 'Đang ghi…' : 'Xác nhận'}</Button
			>
		</div>
	{/if}
</Modal>
<Modal bind:open={previewOpen} title="Xem trước Discord" wide>
	<label class="field"
		>Người nhận<select bind:value={previewRecipient}
			>{#each bill?.lines ?? [] as line}<option value={line.memberId}
					>{bill?.memberNames?.[line.memberId] ?? line.memberId}</option
				>{/each}</select
		>
	</label>
	{#if previewMessage}<DiscordPreview message={previewMessage} {groupId} imageId={reviewImageId} />{/if}
</Modal>
