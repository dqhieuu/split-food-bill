<script lang="ts">
	import { page } from '$app/state';
	import {
		Search,
		Download,
		ReceiptText,
		ArrowUpRight,
		ArrowDownLeft,
		Mail,
		RotateCcw,
		Eye,
		SlidersHorizontal,
		CalendarDays
	} from '@lucide/svelte';
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import Modal from '../Modal.svelte';
	import Avatar from '../Avatar.svelte';
	import EmptyState from '../EmptyState.svelte';
	import type { AppState, Bill } from '$lib/domain/types';
	import type { RunCommand } from '$lib/client/types';
	import { currency, dateLabel, localDate, receiptHtml } from '$lib/domain/ledger';
	import { preferences } from '$lib/client/preferences.svelte';
	let { appState, actor, run, busy }: { appState: AppState; actor: string; run: RunCommand; busy: boolean } =
		$props();
	let tab = $state('bills');
	let search = $state('');
	let typeFilter = $state('all');
	// svelte-ignore state_referenced_locally
	let memberFilter = $state(actor);
	let fromDate = $state('');
	let toDate = $state('');
	let rowLimit = $state(30);
	let detailOpen = $state(false);
	let selectedBillId = $state('');
	let mailOpen = $state(false);
	const name = (id: string) => appState.members.find((m) => m.id === id)?.name || id;
	const matchesDate = (date: string) =>
		(!fromDate || localDate(date) >= fromDate) && (!toDate || localDate(date) <= toDate);
	const bills = $derived(
		[...appState.bills]
			.filter(
				(b) =>
					`${b.description} ${name(b.organizer)} ${b.lines.map((l) => l.description).join(' ')}`
						.toLocaleLowerCase('vi')
						.includes(search.toLocaleLowerCase('vi')) &&
					matchesDate(b.date) &&
					(memberFilter === 'all' ||
						b.organizer === memberFilter ||
						b.lines.some((l) => l.memberId === memberFilter))
			)
			.sort((a, b) => b.date.localeCompare(a.date))
	);
	const entries = $derived(
		[...appState.ledger]
			.filter(
				(e) =>
					`${e.description} ${e.note} ${name(e.from)} ${name(e.to)}`
						.toLocaleLowerCase('vi')
						.includes(search.toLocaleLowerCase('vi')) &&
					matchesDate(e.date) &&
					(memberFilter === 'all' || e.from === memberFilter || e.to === memberFilter) &&
					(typeFilter === 'all' || e.type === typeFilter)
			)
			.sort((a, b) => b.date.localeCompare(a.date))
	);
	const selectedBill = $derived(appState.bills.find((b) => b.id === selectedBillId));
	const receipt = $derived(appState.receipts.find((r) => r.billId === selectedBillId));
	const canProcess = $derived(
		selectedBill?.organizer === actor || appState.members.find((m) => m.id === actor)?.role === 'admin'
	);
	const receiptLabels = { queued: 'Chờ mô phỏng', simulated: 'Đã mô phỏng', failed: 'Mô phỏng thất bại' };
	$effect(() => {
		const requested = page.url.searchParams.get('bill');
		if (requested && requested !== selectedBillId && appState.bills.some((b) => b.id === requested)) {
			selectedBillId = requested;
			detailOpen = true;
		}
	});
	function openBill(bill: Bill) {
		selectedBillId = bill.id;
		detailOpen = true;
	}
	function downloadCsv() {
		const safe = (value: string | number) => {
			let text = String(value);
			if (typeof value === 'string' && /^[\s]*[=+\-@]/.test(text)) text = "'" + text;
			return '"' + text.replaceAll('"', '""') + '"';
		};
		const rows = [
			[
				'Mã',
				'Ngày',
				'Người trả / Người nợ',
				'Người nhận',
				'Loại',
				'Số tiền VND',
				'Nội dung',
				'Ghi chú',
				'Nguồn'
			],
			...entries.map((e) => [
				e.id,
				e.date,
				name(e.from),
				name(e.to),
				e.type === 'debt' ? 'Nợ' : 'Trả',
				e.amount,
				e.description,
				e.note,
				e.source === 'settlement'
					? 'Tối giản nợ'
					: e.source === 'import'
						? 'Nhập lịch sử'
						: e.source === 'qr'
							? 'Xác nhận QR'
							: e.source === 'bill'
								? 'Hóa đơn'
								: 'Hoàn tiền'
			])
		];
		const url = URL.createObjectURL(
			new Blob(['\ufeff' + rows.map((r) => r.map(safe).join(',')).join('\r\n')], {
				type: 'text/csv;charset=utf-8;'
			})
		);
		const anchor = document.createElement('a');
		anchor.href = url;
		anchor.download = `lunchroom-ledger-${localDate(new Date())}.csv`;
		anchor.click();
		URL.revokeObjectURL(url);
	}
	async function simulate(fail: boolean) {
		if (receipt)
			try {
				await run(
					'simulateReceipt',
					{ id: receipt.id, fail },
					fail ? 'Đã mô phỏng tình huống gửi lỗi.' : 'Đã mô phỏng gửi biên nhận; không có email thật.'
				);
			} catch {}
	}
</script>

<div class="page-heading">
	<div>
		<h1>Ledger</h1>
	</div>
	<Button variant="outline" onclick={downloadCsv}><Download size={16} /> Xuất sổ đã lọc</Button>
</div>
<section class="panel">
	<div class="filter-toolbar">
		<div class="segmented-control">
			<button class:active={tab === 'bills'} onclick={() => (tab = 'bills')}
				>Hóa đơn ({appState.bills.length})</button
			><button class:active={tab === 'ledger'} onclick={() => (tab = 'ledger')}
				>Giao dịch ({appState.ledger.length})</button
			>
		</div>
		<span class="subtle-label">Mới nhất trước</span>
	</div>
	<div class="activity-filters">
		<div class="search-field">
			<Search size={17} /><Input
				aria-label="Tìm giao dịch"
				placeholder="Tìm món ăn, tên người, ghi chú…"
				bind:value={search}
			/>
		</div>
		<select aria-label="Lọc thành viên" bind:value={memberFilter}
			><option value="all">Tất cả thành viên</option>{#each appState.members.filter((m) => m.active) as member}<option
					value={member.id}>{member.name}{member.id === actor ? ' (Bạn)' : ''}</option
				>{/each}</select
		>{#if tab === 'ledger'}<select aria-label="Lọc loại giao dịch" bind:value={typeFilter}
				><option value="all">Tất cả giao dịch</option><option value="debt">Nợ</option><option
					value="payment">Trả</option></select
			>{/if}
		<div class="date-filter">
			<Input type="date" aria-label="Từ ngày" bind:value={fromDate} /><span>—</span><Input
				type="date"
				aria-label="Đến ngày"
				bind:value={toDate}
			/>
		</div>
	</div>
	{#if tab === 'bills'}<div class="table-scroll">
			<table class="data-table">
				<thead
					><tr
						><th>Hóa đơn</th><th>Người đã trả</th><th>Thành viên</th><th class="align-right">Tổng tiền</th><th
						></th></tr
					></thead
				><tbody
					>{#each bills.slice(0, rowLimit) as bill}<tr
							><td
								><button class="table-title-button" onclick={() => openBill(bill)}
									><span class="bill-symbol tone-0"><ReceiptText size={18} /></span><span
										><strong>{bill.description}</strong><small>{dateLabel(bill.date)}</small></span
									></button
								></td
							><td
								><div class="table-person">
									<Avatar member={appState.members.find((m) => m.id === bill.organizer)} size="small" />{name(
										bill.organizer
									)}
								</div></td
							><td>{bill.lines.length} người</td><td class="align-right amount-cell"
								>{currency(bill.total)}</td
							><td
								><Button
									variant="ghost"
									size="icon"
									aria-label={`Xem hóa đơn ${bill.description}`}
									onclick={() => openBill(bill)}><ArrowUpRight size={17} /></Button
								></td
							></tr
						>{/each}</tbody
				>
			</table>
		</div>
		{#if !bills.length}<EmptyState
				title="Không tìm thấy hóa đơn"
				description="Thử thay đổi từ khóa hoặc phạm vi ngày."
			/>{/if}
	{:else}<div class="table-scroll">
			<table class="data-table">
				<thead
					><tr
						><th>Ngày & nội dung</th><th>Người nợ / trả</th><th>Người nhận</th><th>Loại</th><th
							class="align-right">Số tiền</th
						></tr
					></thead
				><tbody
					>{#each entries.slice(0, rowLimit) as entry}<tr
							><td
								><strong>{entry.description || 'Không có mô tả'}</strong><small
									>{dateLabel(entry.date)}{entry.note ? ` · ${entry.note}` : ''}</small
								></td
							><td>{name(entry.from)}</td><td>{name(entry.to)}</td><td
								><span
									class="status-pill"
									class:success={entry.type === 'payment'}
									>{entry.type === 'debt' ? 'Nợ' : 'Trả'}</span
								>{#if entry.legacySequence}<small>Số cũ: {entry.legacySequence}</small>{/if}</td
							><td class="align-right amount-cell">{currency(entry.amount)}</td></tr
						>{/each}</tbody
				>
			</table>
		</div>
		{#if !entries.length}<EmptyState
				title="Không tìm thấy giao dịch"
				description="Thử thay đổi bộ lọc để xem thêm dữ liệu."
			/>{/if}{/if}
	<div class="table-footer">
		<span
			>Hiển thị {Math.min(rowLimit, tab === 'bills' ? bills.length : entries.length)} / {tab === 'bills'
				? bills.length
				: entries.length} mục</span
		>{#if rowLimit < (tab === 'bills' ? bills.length : entries.length)}<Button
				variant="outline"
				onclick={() => (rowLimit += 50)}>Xem thêm 50 mục</Button
			>{/if}
	</div>
</section>
<Modal
	bind:open={detailOpen}
	title={selectedBill?.description || 'Chi tiết hóa đơn'}
	description={selectedBill
		? `${name(selectedBill.organizer)} đã thanh toán · ${dateLabel(selectedBill.date)}`
		: ''}
	wide
	>{#if selectedBill}<div class="review-lines">
			{#each selectedBill.lines as line}<div>
					<span
						><strong
							>{name(line.memberId)}{line.memberId === selectedBill.organizer ? ' · Người trả' : ''}</strong
						><small>{line.description}{line.note ? ` · ${line.note}` : ''}</small></span
					><strong>{currency(line.amount)}</strong>
				</div>{/each}
		</div>
		<div class="summary-total"><span>Tổng hóa đơn</span><strong>{currency(selectedBill.total)}</strong></div>
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
		<p class="fine-print">
			Hóa đơn đã ghi được giữ nguyên để bảo toàn lịch sử. Thanh toán được đối trừ ở cấp thành viên.
		</p>{/if}</Modal
>
<Modal
	bind:open={mailOpen}
	title="Xem trước biên nhận email"
	description="Nội dung được tạo từ ảnh chụp hóa đơn lúc ghi nhận. Chưa gửi thư."
	wide
	>{#if selectedBill}<iframe
			title="Nội dung biên nhận email"
			srcdoc={receiptHtml(selectedBill, appState.members)}
			sandbox=""
			class="email-preview"
		></iframe>{/if}</Modal
>
