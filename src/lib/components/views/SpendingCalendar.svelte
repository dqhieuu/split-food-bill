<script lang="ts">
	import { ChevronLeft, ChevronRight } from '@lucide/svelte';
	import type { Bill } from '$lib/domain/types';
	import { currency, localDate } from '$lib/domain/ledger';
	import { toLunar } from '$lib/domain/lunar';
	let { bills }: { bills: Bill[] } = $props();
	const WEEKDAYS = ['T2', 'T3', 'T4', 'T5', 'T6', 'T7', 'CN'];
	const today = localDate(new Date());
	let cursor = $state({ year: Number(today.slice(0, 4)), month: Number(today.slice(5, 7)) });
	const monthKey = $derived(`${cursor.year}-${String(cursor.month).padStart(2, '0')}`);
	const isCurrentMonth = $derived(monthKey === today.slice(0, 7));
	const totals = $derived.by(() => {
		const byDay = new Map<string, number>();
		for (const bill of bills) {
			const key = localDate(bill.date);
			if (key.startsWith(monthKey)) byDay.set(key, (byDay.get(key) ?? 0) + bill.total);
		}
		return byDay;
	});
	const max = $derived(Math.max(0, ...totals.values()));
	const monthTotal = $derived([...totals.values()].reduce((a, b) => a + b, 0));
	const cells = $derived.by(() => {
		const daysInMonth = new Date(Date.UTC(cursor.year, cursor.month, 0)).getUTCDate();
		const leading = (new Date(Date.UTC(cursor.year, cursor.month - 1, 1)).getUTCDay() + 6) % 7;
		return [
			...Array.from({ length: leading }, () => null),
			...Array.from({ length: daysInMonth }, (_, i) => {
				const day = i + 1;
				const key = `${monthKey}-${String(day).padStart(2, '0')}`;
				const lunar = toLunar(day, cursor.month, cursor.year);
				const value = totals.get(key) ?? 0;
				return {
					day,
					key,
					lunar:
						lunar.day === 1 || day === 1
							? `${lunar.day}/${lunar.month}${lunar.leap ? 'N' : ''}`
							: `${lunar.day}`,
					isLunarMonthStart: lunar.day === 1,
					value,
					ratio: max ? value / max : 0
				};
			})
		];
	});
	function shift(step: number) {
		const index = cursor.year * 12 + cursor.month - 1 + step;
		cursor = { year: Math.floor(index / 12), month: (index % 12) + 1 };
	}
</script>

<section class="panel calendar-panel">
	<div class="panel-heading">
		<div>
			<h2>Lịch chi tiêu</h2>
			<p>{currency(monthTotal)} trong tháng · Thanh đầy = ngày chi nhiều nhất</p>
		</div>
		<div class="calendar-nav">
			<button class="icon-button" aria-label="Tháng trước" onclick={() => shift(-1)}
				><ChevronLeft size={18} /></button
			><strong>Tháng {cursor.month}/{cursor.year}</strong><button
				class="icon-button"
				aria-label="Tháng sau"
				disabled={isCurrentMonth}
				onclick={() => shift(1)}><ChevronRight size={18} /></button
			>
		</div>
	</div>
	<div class="spending-calendar" role="grid" aria-label={`Chi tiêu tháng ${cursor.month}/${cursor.year}`}>
		{#each WEEKDAYS as weekday}<span class="calendar-weekday" role="columnheader">{weekday}</span>{/each}
		{#each cells as cell}{#if cell}<div
					class="calendar-day"
					class:today={cell.key === today}
					class:future={cell.key > today}
					role="gridcell"
					title={`${cell.day}/${cursor.month} (âm lịch ${cell.lunar}): ${currency(cell.value)}`}
				>
					<div class="calendar-dates">
						<strong>{cell.day}</strong><small class:lunar-start={cell.isLunarMonthStart}>{cell.lunar}</small>
					</div>
					<div class="calendar-bar" aria-hidden="true">
						<span
							style:width={`${cell.ratio * 100}%`}
							style:--intensity={`${Math.round(25 + cell.ratio * 75)}%`}
						></span>
					</div>
					<small class="calendar-amount">{cell.value ? currency(cell.value) : ''}</small>
				</div>{:else}<div class="calendar-day empty" role="gridcell"></div>{/if}{/each}
	</div>
</section>
