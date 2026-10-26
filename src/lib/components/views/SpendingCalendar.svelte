<script lang="ts">
	import { ChevronLeft, ChevronRight, ChevronDown, Plus, X } from '@lucide/svelte';
	import { Popover } from 'bits-ui';
	import { Button } from '$lib/components/ui/button';
	import type { Bill, Member } from '$lib/domain/types';
	import { currency, localDate } from '$lib/domain/ledger';
	import { toLunar } from '$lib/domain/lunar';
	import {
		calendarMonth,
		daysInMonth,
		severityHue,
		spendingIndicatorColor,
		spendingDensityRatio,
		type CalendarBill
	} from '$lib/domain/calendar';
	// A day cell has room for three 22px bill bars; past that, compact mode shows two plus "+N".
	const MAX_BARS = 3;
	const COMPACT_BARS = 2;
	const WEEKDAYS = ['T2', 'T3', 'T4', 'T5', 'T6', 'T7', 'CN'];
	const FALLBACK_COLOR = '#7f8a77';
	let { bills, members = [] }: { bills: Bill[]; members?: Pick<Member, 'id' | 'name' | 'color'>[] } =
		$props();
	const today = localDate(new Date());
	let cursor = $state({ year: Number(today.slice(0, 4)), month: Number(today.slice(5, 7)) });
	let selectedKey = $state(today);
	let payerFilter = $state('all');
	let overflowMode = $state<'compact' | 'scroll'>('compact');
	let openPopover = $state<string | null>(null);
	const monthKey = $derived(`${cursor.year}-${String(cursor.month).padStart(2, '0')}`);
	const isCurrentMonth = $derived(monthKey === today.slice(0, 7));
	const memberOf = (id: string) => members.find((m) => m.id === id);
	const payerName = (bill: Bill) =>
		bill.memberNames?.[bill.organizer] || memberOf(bill.organizer)?.name || bill.organizer;
	const colorOf = (id: string) => memberOf(id)?.color || FALLBACK_COLOR;
	const monthPayers = $derived.by(() => {
		const seen = new Map<string, string>();
		for (const bill of bills)
			if (localDate(bill.date).startsWith(monthKey)) seen.set(bill.organizer, payerName(bill));
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
					barColor: spendingIndicatorColor(
						spendingDensityRatio(
							total,
							month.personMeals.get(key) ?? 0,
							month.monthTotal,
							month.monthPersonMeals
						)
					)
				};
			})
		];
	});
	const selected = $derived(cells.find((cell) => cell?.key === selectedKey) ?? null);
	const dateLabel = (key: string) => `${key.slice(8)}/${key.slice(5, 7)}/${key.slice(0, 4)}`;
	const shortDate = (key: string) => `${Number(key.slice(8))}/${Number(key.slice(5, 7))}`;
	function shift(step: number) {
		const index = cursor.year * 12 + cursor.month - 1 + step;
		cursor = { year: Math.floor(index / 12), month: (index % 12) + 1 };
		selectedKey = monthKey === today.slice(0, 7) ? today : `${monthKey}-01`;
		openPopover = null;
	}
	function onCellKey(event: KeyboardEvent, key: string) {
		if (event.target !== event.currentTarget || (event.key !== 'Enter' && event.key !== ' ')) return;
		event.preventDefault();
		selectedKey = key;
	}
</script>

{#snippet payerBadge(bill: CalendarBill, short = false)}
	<span class="cal-payer" style:--payer={colorOf(bill.payerId)}
		>{short ? bill.payer.split(' ').at(-1) : bill.payer}</span
	>
{/snippet}

{#snippet billBar(bill: CalendarBill)}
	<div
		class="cal-bill"
		style:--hue={severityHue(bill.ratio)}
		title={`${bill.description} · Người trả: ${bill.payer} · ${currency(bill.amount)}`}
	>
		<span class="cal-bill-left"
			><i class="cal-dot"></i><span class="cal-bill-name">{bill.description}</span></span
		>
		{@render payerBadge(bill, true)}
	</div>
{/snippet}

{#snippet billRow(bill: CalendarBill, index: number)}
	<a class="cal-row" href={`/activity?bill=${bill.id}`} style:--hue={severityHue(bill.ratio)}>
		<i class="cal-dot"></i><span class="cal-row-index">{index + 1}.</span>
		<span class="cal-row-text"
			><strong title={bill.description}>{bill.description}</strong><small class="cal-amount"
				>{currency(bill.amount)}</small
			></span
		>
		{@render payerBadge(bill)}
	</a>
{/snippet}

<section class="panel calendar-panel">
	<header class="cal-header">
		<div>
			<div class="cal-title">
				<h2>Lịch chi tiêu</h2>
				<span class="cal-legend" title={`Hóa đơn lớn nhất: ${currency(month.maxBill)}`}
					>Thấp<i aria-hidden="true"></i>Cao nhất</span
				>
			</div>
			<p class="cal-subtitle">
				<strong>{currency(month.monthTotal)}</strong> trong tháng · Thanh đầy = ngày chi nhiều nhất · Màu
				thanh: <span class="tone-low">Xanh (Thấp)</span> →
				<span class="tone-mid">Vàng (Vừa)</span> → <span class="tone-high">Đỏ (Cao)</span>
			</p>
		</div>
		<div class="cal-controls">
			<div class="cal-toggle" role="group" aria-label="Cách hiển thị khi nhiều hóa đơn">
				<button
					class:active={overflowMode === 'compact'}
					aria-pressed={overflowMode === 'compact'}
					title="Hiển thị 2 hóa đơn đầu + nút +N hóa đơn khác"
					onclick={() => (overflowMode = 'compact')}>Gọn (+N bill)</button
				><button
					class:active={overflowMode === 'scroll'}
					aria-pressed={overflowMode === 'scroll'}
					title="Cuộn tất cả hóa đơn bên trong ô"
					onclick={() => ((overflowMode = 'scroll'), (openPopover = null))}>Cuộn trong ô</button
				>
			</div>
			{#if monthPayers.length}<div class="cal-filter" role="group" aria-label="Lọc theo người trả">
					<span>Người trả:</span>
					<button
						class:active={!activePayer}
						aria-pressed={!activePayer}
						onclick={() => (payerFilter = 'all')}>Tất cả</button
					>{#each monthPayers as payer (payer.id)}<button
							class:active={activePayer === payer.id}
							aria-pressed={activePayer === payer.id}
							style:--payer={colorOf(payer.id)}
							onclick={() => (payerFilter = payer.id)}><i></i>{payer.name}</button
						>{/each}
				</div>{/if}
			<div class="cal-month">
				<button class="icon-button" aria-label="Tháng trước" onclick={() => shift(-1)}
					><ChevronLeft size={16} /></button
				><strong>Tháng {cursor.month}/{cursor.year}</strong><button
					class="icon-button"
					aria-label="Tháng sau"
					disabled={isCurrentMonth}
					onclick={() => shift(1)}><ChevronRight size={16} /></button
				>
			</div>
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
						<strong class:muted={cell.key > today && !cell.total}>{cell.day}</strong><small
							class:lunar-start={cell.isLunarMonthStart}>{cell.lunar}</small
						>
					</div>
					<div class="cal-pay">
						<div class="cal-track" aria-hidden="true">
							<span
								style:width={cell.total ? `${Math.max(8, Math.round(cell.ratio * 100))}%` : '0%'}
								style:background-color={cell.barColor}
							></span>
						</div>
						<div class="cal-pay-meta">
							<span class="cal-amount" style:--hue={severityHue(cell.ratio)}
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
												<p class="cal-amount" style:--hue={severityHue(cell.ratio)}>
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

	{#if selected}<div class="cal-bottom">
			<section class="cal-inspector" aria-live="polite">
				<div class="cal-inspector-head">
					<span class="cal-date-chip"
						><strong>{shortDate(selected.key)}</strong><small>ÂL {selected.lunarFull}</small></span
					>
					<h3>Danh sách hóa đơn Ngày {dateLabel(selected.key)}</h3>
					<span class="cal-total-badge" style:--hue={severityHue(selected.ratio)}
						>{currency(selected.total)} ({selected.bills.length} bill)</span
					>
				</div>
				{#if selected.bills.length}<div class="cal-inspector-list">
						{#each selected.bills as bill, index (bill.id)}{@render billRow(bill, index)}{/each}
					</div>{:else}<p class="cal-empty">Chưa có hóa đơn nào trong ngày này.</p>{/if}
			</section>
			<section class="cal-add">
				<h3><i></i>Thêm hóa đơn vào Ngày {shortDate(selected.key)}</h3>
				<p>Mở trang ghi thanh toán với ngày đã chọn.</p>
				<Button href={`/new-bill?date=${selected.key}`}
					><Plus size={16} /> Thêm vào Ngày {selected.day}</Button
				>
			</section>
		</div>{/if}
</section>
