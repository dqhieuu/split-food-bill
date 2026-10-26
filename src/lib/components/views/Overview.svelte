<script lang="ts">
	import {
		Plus,
		ArrowRight,
		Wallet,
		ReceiptText,
		Utensils,
		ChevronRight,
		ChevronLeft,
		Coffee
	} from '@lucide/svelte';
	import { Button } from '$lib/components/ui/button';
	import Avatar from '../Avatar.svelte';
	import SpendingCalendar from './SpendingCalendar.svelte';
	import type { AppState } from '$lib/domain/types';
	import { currency, shortCurrency, dateLabel } from '$lib/domain/ledger';
	import { spendingWindow, personalPaymentHistory, type SpendingGranularity } from '$lib/domain/spending';
	let { appState, actor }: { appState: AppState; actor: string } = $props();
	let granularity = $state<SpendingGranularity>('month');
	let windowOffset = $state(0);
	const names = { day: 'ngày', week: 'tuần', month: 'tháng' };
	const currentLabels = { day: 'Hôm nay', week: 'Tuần này', month: 'Tháng này' };
	const activeIds = $derived(
		new Set(appState.members.filter((member) => member.active).map((member) => member.id))
	);
	const history = $derived(personalPaymentHistory(appState.ledger, actor, activeIds).slice(0, 5));
	const recentBills = $derived([...appState.bills].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 4));
	const window = $derived(spendingWindow(appState.bills, granularity, windowOffset));
	const max = $derived(Math.max(1, ...window.buckets.map((bucket) => bucket.value)));
	const summary = $derived(
		windowOffset === 0
			? window.buckets.at(-1)!.value
			: window.buckets.reduce((sum, bucket) => sum + bucket.value, 0)
	);
	const shortDate = (key: string) => `${Number(key.slice(8))}/${Number(key.slice(5, 7))}`;
	const bucketLabel = (key: string) =>
		granularity === 'month' ? `T${Number(key.slice(5, 7))}/${key.slice(2, 4)}` : shortDate(key);
	function changeGranularity(value: SpendingGranularity) {
		granularity = value;
		windowOffset = 0;
	}
</script>

<div class="page-heading">
	<div><h1>Tổng quan</h1></div>
	<Button href="/new-bill" class="primary-action"><Plus size={18} /> Tạo hoá đơn</Button>
</div>
<div class="overview-grid">
	<section class="panel recent-panel">
		<div class="panel-heading">
			<h2>Hóa đơn gần đây</h2>
			<a class="text-link" href="/activity">Xem tất cả <ArrowRight size={15} /></a>
		</div>
		<div class="bill-list">
			{#each recentBills as bill, i}<a class="bill-row" href={`/activity?bill=${bill.id}`}>
					<span class="bill-symbol tone-{i % 3}"
						>{#if i % 3 === 0}<Utensils size={21} />{:else if i % 3 === 1}<Coffee
								size={21}
							/>{:else}<ReceiptText size={21} />{/if}</span
					>
					<div class="bill-info">
						<strong>{bill.description}</strong><span
							>{appState.members.find((member) => member.id === bill.organizer)?.name} đã trả
							<span class="middot">·</span>
							{dateLabel(bill.date)}</span
						>
					</div>
					<div class="bill-row-right">
						<strong>{currency(bill.total)}</strong>
						<div class="avatar-stack">
							{#each bill.lines.slice(0, 3) as line}<Avatar
									member={appState.members.find((member) => member.id === line.memberId)}
									size="small"
								/>{/each}<small>{bill.lines.length} người</small>
						</div>
					</div>
					<ChevronRight size={16} />
				</a>{/each}
		</div>
	</section>
	<section class="panel payment-history-panel">
		<div class="panel-heading">
			<h2>Lịch sử thanh toán của bạn</h2>
			<Wallet size={19} />
		</div>
		<div class="payment-history-list">
			{#each history as item}
				{@const member = appState.members.find((person) => person.id === item.counterpartyId)}
				<a
					class="payment-history-row"
					href={item.entry.source === 'bill' ? `/activity?bill=${item.entry.reference}` : '/activity'}
				>
					<Avatar {member} size="small" />
					<div>
						<strong
							>{#if item.direction === 'you-paid-for'}Bạn đã trả cho {member?.name}{:else if item.direction === 'paid-for-you'}{member?.name}
								đã trả cho bạn{:else if item.direction === 'sent-transfer'}Bạn đã chuyển tiền cho {member?.name}{:else}{member?.name}
								đã chuyển tiền cho bạn{/if}</strong
						>
						<small>{dateLabel(item.entry.date)} · {item.entry.description}</small>
					</div>
					<strong class="payment-history-amount">{currency(item.entry.amount)}</strong>
				</a>
			{:else}<p class="payment-history-empty">Chưa có thanh toán.</p>{/each}
		</div>
		<a href="/activity" class="panel-bottom-link">Xem lịch sử <ArrowRight size={16} /></a>
	</section>
	<section class="panel spending-panel">
		<div class="panel-heading spending-heading">
			<h2>Chi tiêu theo {names[granularity]}</h2>
			<div class="segmented-control" role="group" aria-label="Đơn vị thời gian chi tiêu">
				{#each ['day', 'week', 'month'] as value}{@const unit = value as SpendingGranularity}<button
						class:active={granularity === unit}
						aria-pressed={granularity === unit}
						onclick={() => changeGranularity(unit)}
						>{unit === 'day' ? 'Ngày' : unit === 'week' ? 'Tuần' : 'Tháng'}</button
					>{/each}
			</div>
		</div>
		<div class="spending-summary">
			<strong>{windowOffset === 0 ? currentLabels[granularity] : 'Khoảng này'}: {currency(summary)}</strong>
		</div>
		<div class="spending-window-controls">
			<button class="icon-button" aria-label="Khoảng trước" onclick={() => windowOffset++}
				><ChevronLeft size={18} /></button
			>
			<span>{dateLabel(window.start)} – {dateLabel(window.end)}</span>
			<button
				class="icon-button"
				aria-label="Khoảng sau"
				disabled={windowOffset === 0}
				onclick={() => windowOffset--}><ChevronRight size={18} /></button
			>
			{#if windowOffset > 0}<button class="text-link" onclick={() => (windowOffset = 0)}>Hiện tại</button
				>{/if}
		</div>
		<div
			class="bar-chart"
			role="img"
			aria-label={`Chi tiêu theo ${names[granularity]} từ ${dateLabel(window.start)} đến ${dateLabel(window.end)}`}
		>
			<div class="chart-grid-lines">
				<span>{shortCurrency(max)}</span><span>{shortCurrency(max / 2)}</span><span>0 ₫</span>
			</div>
			<div
				class="chart-columns"
				style:grid-template-columns={`repeat(${window.buckets.length}, minmax(0, 1fr))`}
			>
				{#each window.buckets as bucket}<div class="chart-column">
						<div class="bar-track">
							<div
								class="bar"
								class:today={bucket.current}
								style:height={`${Math.max(bucket.value ? 3 : 0, (bucket.value / max) * 100)}%`}
								title={`${dateLabel(bucket.key)}: ${currency(bucket.value)}`}
							>
								<span class="bar-tooltip">{dateLabel(bucket.key)}<br />{currency(bucket.value)}</span>
							</div>
						</div>
						<span class:today-label={bucket.current}>{bucketLabel(bucket.key)}</span>
					</div>{/each}
			</div>
		</div>
	</section>
	<SpendingCalendar bills={appState.bills} members={appState.members} />
</div>
