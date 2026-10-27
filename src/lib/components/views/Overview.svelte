<script lang="ts">
	import { Plus, ArrowRight, Wallet, Utensils, ChevronRight, ChevronLeft } from '@lucide/svelte';
	import { Button } from '$lib/components/ui/button';
	import Avatar from '../Avatar.svelte';
	import BillDetail from '../BillDetail.svelte';
	import SpendingCalendar from './SpendingCalendar.svelte';
	import type { AppState } from '$lib/domain/types';
	import type { RunCommand } from '$lib/client/types';
	import {
		currency,
		shortCurrency,
		dateLabel,
		billDateLabel,
		dateTimeLabel,
		localDate,
		compareBillsByCreatedAt
	} from '$lib/domain/ledger';
	import { spendingWindow, personalPaymentHistory, type SpendingGranularity } from '$lib/domain/spending';
	let {
		appState,
		actor,
		run,
		busy,
		groupId
	}: { appState: AppState; actor: string; run: RunCommand; busy: boolean; groupId: string } = $props();
	let detailOpen = $state(false);
	let selectedBillId = $state('');
	const selectedBill = $derived(appState.bills.find((bill) => bill.id === selectedBillId));
	const name = (id: string) => appState.members.find((member) => member.id === id)?.name || id;
	let granularity = $state<SpendingGranularity>('month');
	let windowOffset = $state(0);
	let calendarMonth = $state(localDate(new Date()).slice(0, 7));
	const names = { day: 'ngày', week: 'tuần', month: 'tháng' };
	const activeIds = $derived(
		new Set(appState.members.filter((member) => member.active).map((member) => member.id))
	);
	const history = $derived(personalPaymentHistory(appState.ledger, actor, activeIds).slice(0, 10));
	// Undone bills stay in the ledger for history but no longer count as spending.
	const liveBills = $derived(appState.bills.filter((bill) => !bill.undoneAt));
	const recentBills = $derived([...liveBills].sort(compareBillsByCreatedAt).slice(0, 10));
	const window = $derived(spendingWindow(liveBills, granularity, windowOffset));
	const max = $derived(Math.max(1, ...window.buckets.map((bucket) => bucket.value)));
	const shortDate = (key: string) => `${Number(key.slice(8))}/${Number(key.slice(5, 7))}`;
	const bucketLabel = (key: string) =>
		granularity === 'month' ? `T${Number(key.slice(5, 7))}/${key.slice(2, 4)}` : shortDate(key);
	function changeGranularity(value: SpendingGranularity) {
		granularity = value;
		windowOffset = 0;
	}
	function openBill(id: string) {
		selectedBillId = id;
		detailOpen = true;
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
			{#each recentBills as bill}<button
					class="bill-row"
					onclick={() => {
						selectedBillId = bill.id;
						detailOpen = true;
					}}
				>
					<span class="bill-symbol tone-0"><Utensils size={21} /></span>
					<div class="bill-info">
						<strong>{bill.description}</strong><span
							>{appState.members.find((member) => member.id === bill.organizer)?.name} trả
							<span class="middot">·</span>
							Ăn vào {billDateLabel(bill.date)}</span
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
				</button>{:else}<p class="overview-empty">Chưa có hóa đơn.</p>{/each}
		</div>
	</section>
	<section class="panel payment-history-panel">
		<div class="panel-heading">
			<h2>Các khoản tiền liên quan đến bạn</h2>
			<Wallet size={19} />
		</div>
		<div class="payment-history-list">
			{#each history as item}
				{@const member = appState.members.find((person) => person.id === item.counterpartyId)}
				{@const payerId = item.entry.type === 'debt' ? item.entry.to : item.entry.from}
				{@const recipientId = item.entry.type === 'debt' ? item.entry.from : item.entry.to}
				{@const bill =
					item.entry.source === 'bill' && appState.bills.find((bill) => bill.id === item.entry.reference)}
				{#snippet rowContent()}
					<Avatar {member} size="small" />
					<div>
						<strong
							>{payerId === actor ? 'Bạn' : name(payerId)} trả tiền cho {recipientId === actor
								? 'bạn'
								: name(recipientId)}</strong
						>
						<small>{dateTimeLabel(item.entry.createdAt)} · {item.entry.description}</small>
					</div>
					<strong class="payment-history-amount">{currency(item.entry.amount)}</strong>
				{/snippet}
				{#if bill}<button class="payment-history-row" onclick={() => openBill(bill.id)}>
						{@render rowContent()}
					</button>
				{:else}<div class="payment-history-row">{@render rowContent()}</div>{/if}
			{:else}<p class="overview-empty">Chưa có thanh toán.</p>{/each}
		</div>
		<a href="/activity?tab=ledger" class="panel-bottom-link">Xem lịch sử <ArrowRight size={16} /></a>
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
			role="group"
			aria-label={`Chi tiêu theo ${names[granularity]} từ ${dateLabel(window.start)} đến ${dateLabel(window.end)}`}
		>
			<div class="chart-grid-lines">
				<span>{shortCurrency(max)}</span><span>{shortCurrency(max / 2)}</span><span>0 ₫</span>
			</div>
			<div
				class="chart-columns"
				style:grid-template-columns={`repeat(${window.buckets.length}, minmax(0, 1fr))`}
			>
				{#each window.buckets as bucket}
					{#snippet columnContent()}
						<div class="bar-track">
							<div
								class="bar"
								class:today={bucket.current}
								style:height={`${Math.max(bucket.value ? 3 : 0, (bucket.value / max) * 100)}%`}
								title={`${dateLabel(bucket.key)}: ${currency(bucket.value)}`}
							>
								<span class="bar-value">{currency(bucket.value)}</span>
							</div>
						</div>
						<span class:today-label={bucket.current}>{bucketLabel(bucket.key)}</span>
					{/snippet}
					{#if granularity === 'month'}
						<button
							class="chart-column"
							aria-label={`Xem lịch chi tiêu tháng ${Number(bucket.key.slice(5, 7))}/${bucket.key.slice(0, 4)}: ${currency(bucket.value)}`}
							aria-pressed={calendarMonth === bucket.key.slice(0, 7)}
							onclick={() => (calendarMonth = bucket.key.slice(0, 7))}>{@render columnContent()}</button
						>
					{:else}<div class="chart-column">{@render columnContent()}</div>{/if}
				{/each}
			</div>
		</div>
	</section>
	<SpendingCalendar
		bind:monthKey={calendarMonth}
		bills={liveBills}
		members={appState.members}
		onBillClick={(id) => {
			selectedBillId = id;
			detailOpen = true;
		}}
	/>
</div>
<BillDetail bind:open={detailOpen} bill={selectedBill} {appState} {actor} {run} {busy} {groupId} />
