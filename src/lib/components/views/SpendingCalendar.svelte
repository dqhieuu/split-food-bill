<script lang="ts">
	import { ChevronLeft, ChevronRight, ChevronDown, Plus, X } from '@lucide/svelte';
	import { Popover } from 'bits-ui';
	import type { Bill, Member } from '$lib/domain/types';
	import { currency, localDate, billDateLabel, dateTimeLabel } from '$lib/domain/ledger';
	import { toLunar } from '$lib/domain/lunar';
	import {
		calendarMonth,
		daysInMonth,
		spendingPercentageColor,
		type CalendarBill
	} from '$lib/domain/calendar';
	// A day cell has room for three 22px bill bars; past that, compact mode shows two plus "+N".
	const MAX_BARS = 3;
	const COMPACT_BARS = 2;
	const WEEKDAYS = ['T2', 'T3', 'T4', 'T5', 'T6', 'T7', 'CN'];
	const FALLBACK_COLOR = '#7f8a77';
	let {
		bills,
		members = [],
		monthKey = $bindable(localDate(new Date()).slice(0, 7)),
		onBillClick
	}: {
		bills: Bill[];
		members?: Pick<Member, 'id' | 'name' | 'color' | 'active'>[];
		monthKey?: string;
		onBillClick: (id: string) => void;
	} = $props();
	const today = localDate(new Date());
	const cursor = $derived({ year: Number(monthKey.slice(0, 4)), month: Number(monthKey.slice(5, 7)) });
	let selectedKey = $state(today);
	let payerFilter = $state('all');
	let overflowMode = $state<'compact' | 'scroll'>('compact');
	let openPopover = $state<string | null>(null);
	$effect(() => {
		selectedKey = monthKey === today.slice(0, 7) ? today : `${monthKey}-01`;
		openPopover = null;
	});
	const memberOf = (id: string) => members.find((m) => m.id === id);
	const payerName = (bill: Bill) =>
		bill.memberNames?.[bill.organizer] || memberOf(bill.organizer)?.name || bill.organizer;
	const colorOf = (id: string) => memberOf(id)?.color || FALLBACK_COLOR;
	const monthPayers = $derived.by(() => {
		const seen = new Map<string, string>();
		for (const bill of bills)
			if (localDate(bill.date).startsWith(monthKey) && memberOf(bill.organizer)?.active)
				seen.set(bill.organizer, payerName(bill));
		return [...seen].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name, 'vi'));
	});
	const activePayer = $derived(monthPayers.some((p) => p.id === payerFilter) ? payerFilter : undefined);
	const month = $derived(calendarMonth(bills, monthKey, payerName, activePayer));
	const cells = $derived.by(() => {
		const monthDays = daysInMonth(cursor.year, cursor.month);
		const leading = (new Date(Date.UTC(cursor.year, cursor.month - 1, 1)).getUTCDay() + 6) % 7;
		return [
			...Array.from({ length: leading }, () => null),
			...Array.from({ length: monthDays }, (_, i) => {
				const day = i + 1;
				const key = `${monthKey}-${String(day).padStart(2, '0')}`;
				const lunar = toLunar(day, cursor.month, cursor.year);
				const lunarFull = `${lunar.day}/${lunar.month}${lunar.leap ? 'N' : ''}`;
				const total = month.totals.get(key) ?? 0;
				return {
					day,
					key,
					lunar: lunar.day === 1 || day === 1 ? lunarFull : `${lunar.day}`,
					lunarFull,
					isLunarMonthStart: lunar.day === 1,
					bills: month.days.get(key) ?? [],
					total,
					ratio: total / month.maxDayTotal,
					barColor: spendingPercentageColor(total / month.maxDayTotal)
				};
			})
		];
	});
	const dateLabel = billDateLabel;
	function shift(step: number) {
		const index = cursor.year * 12 + cursor.month - 1 + step;
		monthKey = `${Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, '0')}`;
	}
	function onCellKey(event: KeyboardEvent, key: string) {
		if (event.target !== event.currentTarget || (event.key !== 'Enter' && event.key !== ' ')) return;
		event.preventDefault();
		selectedKey = key;
	}
	function openBill(id: string) {
		openPopover = null;
		onBillClick(id);
	}
</script>

{#snippet payerBadge(bill: CalendarBill, short = false)}
	<span class="cal-payer" style:--payer={colorOf(bill.payerId)}
		>{short ? bill.payer.split(' ').at(-1) : bill.payer}</span
	>
{/snippet}

{#snippet billBar(bill: CalendarBill)}
	<button
		class="cal-bill"
		onclick={() => openBill(bill.id)}
		style:--spend-color={bill.color}
		title={`${bill.description} · Người trả: ${bill.payer} · ${currency(bill.amount)} · Tạo: ${dateTimeLabel(bill.createdAt)}`}
	>
		<span class="cal-bill-left"
			><i class="cal-dot"></i><span class="cal-bill-name">{bill.description}</span></span
		>
		{@render payerBadge(bill, true)}
	</button>
{/snippet}

{#snippet billRow(bill: CalendarBill, index: number)}
	<button class="cal-row" onclick={() => openBill(bill.id)} style:--spend-color={bill.color}>
		<i class="cal-dot"></i><span class="cal-row-index">{index + 1}.</span>
		<span class="cal-row-text"
			><strong title={bill.description}>{bill.description}</strong><small class="cal-amount"
				>{currency(bill.amount)}</small
			><small class="cal-created">Tạo: {dateTimeLabel(bill.createdAt)}</small></span
		>
		{@render payerBadge(bill)}
	</button>
{/snippet}

<section class="panel calendar-panel">
	<header class="cal-header">
		<div class="cal-top-row">
			<div>
				<h2>Lịch chi tiêu</h2>
				<p class="cal-subtitle">{currency(month.monthTotal)}</p>
			</div>
			<div class="cal-month">
				<button class="icon-button" aria-label="Tháng trước" onclick={() => shift(-1)}
					><ChevronLeft size={16} /></button
				>
				<strong>Tháng {cursor.month}/{cursor.year}</strong>
				<button class="icon-button" aria-label="Tháng sau" onclick={() => shift(1)}
					><ChevronRight size={16} /></button
				>
			</div>
		</div>
		<div class="cal-controls">
			<div class="cal-toggle" role="group" aria-label="Cách hiển thị khi nhiều hóa đơn">
				<button
					class:active={overflowMode === 'compact'}
					aria-pressed={overflowMode === 'compact'}
					onclick={() => (overflowMode = 'compact')}>Gọn (+N bill)</button
				>
				<button
					class:active={overflowMode === 'scroll'}
					aria-pressed={overflowMode === 'scroll'}
					onclick={() => ((overflowMode = 'scroll'), (openPopover = null))}>Cuộn trong ô</button
				>
			</div>
			{#if monthPayers.length}<div class="cal-filter" role="group" aria-label="Lọc theo người trả">
					<span>Người trả:</span>
					<button
						class:active={!activePayer}
						aria-pressed={!activePayer}
						onclick={() => (payerFilter = 'all')}>Tất cả</button
					>
					{#each monthPayers as payer (payer.id)}<button
							class:active={activePayer === payer.id}
							aria-pressed={activePayer === payer.id}
							style:--payer={colorOf(payer.id)}
							onclick={() => (payerFilter = payer.id)}><i></i>{payer.name}</button
						>{/each}
				</div>{/if}
		</div>
	</header>

	<div class="cal-grid" role="grid" aria-label={`Chi tiêu tháng ${cursor.month}/${cursor.year}`}>
		{#each WEEKDAYS as weekday}<span class="cal-weekday" role="columnheader">{weekday}</span>{/each}
		{#each cells as cell}{#if cell}{@const hidden = cell.bills.length - COMPACT_BARS}
				<div
					class="cal-day"
					class:selected={cell.key === selectedKey}
					class:today={cell.key === today}
					role="gridcell"
					tabindex="0"
					aria-selected={cell.key === selectedKey}
					aria-label={`${cell.day}/${cursor.month}: ${currency(cell.total)}, ${cell.bills.length} hóa đơn`}
					onclick={() => (selectedKey = cell.key)}
					onkeydown={(event) => onCellKey(event, cell.key)}
				>
					<div class="cal-date">
						<strong class:muted={cell.key > today && !cell.total}>{cell.day}</strong>
						<span class="cal-lunar">
							<small class:lunar-start={cell.isLunarMonthStart}>{cell.lunar}</small>
							<a
								class="cal-add-inline"
								href={`/new-bill?date=${cell.key}`}
								aria-label={`Thêm hoá đơn ngày ${dateLabel(cell.key)}`}
								title={`Thêm hoá đơn ngày ${dateLabel(cell.key)}`}><Plus size={14} /></a
							>
						</span>
					</div>
					<div class="cal-pay">
						<div class="cal-track" aria-hidden="true">
							<span
								style:width={`${Math.max(0, Math.min(100, cell.ratio * 100))}%`}
								style:background-color={cell.barColor}
							></span>
						</div>
						<div class="cal-pay-meta">
							<span class="cal-amount" style:--spend-color={cell.barColor}
								>{cell.total ? currency(cell.total) : ''}</span
							>{#if cell.bills.length}<small>{cell.bills.length} khoản</small>{/if}
						</div>
					</div>
					<div class="cal-events" class:scrollable={overflowMode === 'scroll'}>
						{#if overflowMode === 'scroll' || cell.bills.length <= MAX_BARS}{#each cell.bills as bill (bill.id)}{@render billBar(
									bill
								)}{/each}{:else}{#each cell.bills.slice(0, COMPACT_BARS) as bill (bill.id)}{@render billBar(
									bill
								)}{/each}<Popover.Root
								open={openPopover === cell.key}
								onOpenChange={(open) => (openPopover = open ? cell.key : null)}
								><Popover.Trigger class="cal-more" title={`Xem đầy đủ ${cell.bills.length} hóa đơn`}
									><span>+{hidden}<span class="cal-more-label">{' hóa đơn khác'}</span></span><ChevronDown
										size={12}
									/></Popover.Trigger
								><Popover.Portal
									><Popover.Content class="cal-popover" side="bottom" align="start" sideOffset={8}
										><div class="cal-popover-head">
											<div>
												<strong>Ngày {dateLabel(cell.key)}</strong><small>Âm lịch: {cell.lunarFull}</small>
												<p class="cal-amount" style:--spend-color={cell.barColor}>
													Tổng cộng: {currency(cell.total)} ({cell.bills.length} hóa đơn)
												</p>
											</div>
											<Popover.Close class="icon-button" aria-label="Đóng"><X size={15} /></Popover.Close>
										</div>
										<div class="cal-popover-list">
											{#each cell.bills as bill, index (bill.id)}{@render billRow(bill, index)}{/each}
										</div></Popover.Content
									></Popover.Portal
								></Popover.Root
							>{/if}
					</div>
				</div>{:else}<div class="cal-day empty" aria-hidden="true"></div>{/if}{/each}
	</div>
</section>
