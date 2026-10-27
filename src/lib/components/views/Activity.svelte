<script lang="ts">
	import { page } from '$app/state';
	import { Search, Download, ReceiptText, ArrowUpRight } from '@lucide/svelte';
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import BillDetail from '../BillDetail.svelte';
	import Avatar from '../Avatar.svelte';
	import EmptyState from '../EmptyState.svelte';
	import type { AppState, Bill } from '$lib/domain/types';
	import type { RunCommand } from '$lib/client/types';
	import {
		currency,
		billDateLabel,
		dateTimeLabel,
		localDate,
		compareLedgerEntries,
		compareBillsByCreatedAt
	} from '$lib/domain/ledger';
	let {
		appState,
		actor,
		run,
		busy,
		groupId
	}: { appState: AppState; actor: string; run: RunCommand; busy: boolean; groupId: string } = $props();
	let tab = $state('bills');
	$effect(() => {
		tab = page.url.searchParams.get('tab') === 'ledger' ? 'ledger' : 'bills';
	});
	let search = $state('');
	let typeFilter = $state('all');
	// svelte-ignore state_referenced_locally
	let memberFilter = $state(actor);
	let fromDate = $state('');
	let toDate = $state('');
	let rowLimit = $state(30);
	let detailOpen = $state(false);
	let selectedBillId = $state('');
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
			.sort(compareBillsByCreatedAt)
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
			.sort(compareLedgerEntries)
	);
	const selectedBill = $derived(appState.bills.find((b) => b.id === selectedBillId));
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
				'Ngày thanh toán',
				'Ngày tạo',
				'Bên A',
				'Loại',
				'Bên B',
				'Số tiền VND',
				'Nội dung',
				'Ghi chú',
				'Nguồn'
			],
			...entries.map((e) => [
				e.id,
				e.date,
				e.createdAt || '',
				name(e.from),
				e.type === 'debt' ? 'Nợ' : 'Trả',
				name(e.to),
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
								: e.source === 'reversal'
									? 'Hoàn tác hóa đơn'
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
</script>

<div class="page-heading">
	<div>
		<h1>Ledger</h1>
	</div>
	<Button variant="outline" onclick={downloadCsv}><Download size={16} /> Xuất file CSV</Button>
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
			><option value="all">Tất cả thành viên</option
			>{#each appState.members.filter((m) => m.active) as member}<option value={member.id}
					>{member.name}{member.id === actor ? ' (Bạn)' : ''}</option
				>{/each}</select
		>{#if tab === 'ledger'}<select aria-label="Lọc loại giao dịch" bind:value={typeFilter}
				><option value="all">Tất cả giao dịch</option><option value="debt">Nợ</option><option value="payment"
					>Trả</option
				></select
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
						><th>Hóa đơn</th><th>Người trả</th><th>Thành viên</th><th class="align-right">Tổng tiền</th><th
						></th></tr
					></thead
				><tbody
					>{#each bills.slice(0, rowLimit) as bill}
						<!-- svelte-ignore a11y_click_events_have_key_events a11y_no_noninteractive_element_interactions (The bill-detail buttons inside the row provide keyboard access.) -->
						<tr class="clickable-bill-row" onclick={() => openBill(bill)}
							><td
								><button class="table-title-button" onclick={() => openBill(bill)}
									><span class="bill-symbol tone-0"><ReceiptText size={18} /></span><span
										><strong
											>{bill.description}{#if bill.undoneAt}
												<span class="status-pill undone-label">Đã hoàn tác</span>{/if}</strong
										><small>Ăn vào {billDateLabel(bill.date)}</small></span
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
			<table class="data-table ledger-table">
				<thead
					><tr
						><th>Ngày & nội dung</th><th>Bên A</th><th>Loại</th><th>Bên B</th><th class="align-right"
							>Số tiền</th
						></tr
					></thead
				><tbody
					>{#each entries.slice(0, rowLimit) as entry}<tr
							><td
								><strong>{entry.description || 'Không có mô tả'}</strong><small
									>{dateTimeLabel(entry.createdAt)}</small
								>{#if entry.note}<small>{entry.note}</small>{/if}
							</td><td>{name(entry.from)}</td><td
								><span
									class="status-pill"
									class:success={entry.type === 'payment'}
									class:danger={entry.type === 'debt'}>{entry.type === 'debt' ? 'Nợ' : 'Trả'}</span
								>{#if entry.legacySequence}<small>Số cũ: {entry.legacySequence}</small>{/if}</td
							><td>{name(entry.to)}</td><td class="align-right amount-cell">{currency(entry.amount)}</td></tr
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
<BillDetail bind:open={detailOpen} bill={selectedBill} {appState} {actor} {run} {busy} {groupId} />
