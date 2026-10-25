<script lang="ts">
	import {
		Plus,
		ArrowRight,
		Wallet,
		ReceiptText,
		Utensils,
		ChevronRight,
		CalendarDays,
		Coffee
	} from '@lucide/svelte';
	import { Button } from '$lib/components/ui/button';
	import Avatar from '../Avatar.svelte';
	import SpendingCalendar from './SpendingCalendar.svelte';
	import type { AppState } from '$lib/domain/types';
	import { currency, shortCurrency, pairBalance, dateLabel, localDate } from '$lib/domain/ledger';
	const MONTHS_SHOWN = 6;
	let { appState, actor }: { appState: AppState; actor: string } = $props();
	const pairs = $derived(
		appState.members
			.filter((m) => m.id !== actor)
			.map((m) => ({ member: m, balance: pairBalance(appState.ledger, actor, m.id) }))
			.filter((p) => p.balance !== 0)
	);
	const currentMonth = localDate(new Date()).slice(0, 7);
	const monthBills = $derived(appState.bills.filter((b) => localDate(b.date).startsWith(currentMonth)));
	const monthSpend = $derived(monthBills.reduce((s, b) => s + b.total, 0));
	const recentBills = $derived([...appState.bills].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 4));
	const months = $derived(
		Array.from({ length: MONTHS_SHOWN }, (_, i) => {
			const [year, month] = currentMonth.split('-').map(Number);
			const index = year * 12 + month - 1 - (MONTHS_SHOWN - 1) + i;
			const key = `${Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, '0')}`;
			return {
				key,
				label: `T${(index % 12) + 1}/${String(Math.floor(index / 12)).slice(2)}`,
				value: appState.bills
					.filter((b) => localDate(b.date).startsWith(key))
					.reduce((s, b) => s + b.total, 0)
			};
		})
	);
	const max = $derived(Math.max(1, ...months.map((m) => m.value)));
</script>

<div class="page-heading">
	<div>
		<h1>Tổng quan</h1>
	</div>
	<Button href="/new-bill" class="primary-action"><Plus size={18} /> Tạo hóa đơn</Button>
</div>
<div class="stat-grid">
	<div class="stat-card">
		<div class="stat-label">
			Chi tiêu của nhóm tháng này <span class="stat-icon"><Utensils size={17} /></span>
		</div>
		<strong>{currency(monthSpend)}</strong><span class="stat-foot"
			><span class="mini-pill">{monthBills.length} hóa đơn</span></span
		>
	</div>
</div>
<div class="overview-grid">
	<section class="panel spending-panel">
		<div class="panel-heading">
			<div>
				<h2>Chi tiêu theo tháng</h2>
			</div>
			<span class="subtle-label"><CalendarDays size={14} /> {MONTHS_SHOWN} tháng gần nhất</span>
		</div>
		<div class="spending-summary">
			<strong>{currency(months.reduce((s, m) => s + m.value, 0))}</strong>
		</div>
		<div class="bar-chart">
			<div class="chart-grid-lines">
				<span>{shortCurrency(max)}</span><span>{shortCurrency(max / 2)}</span><span>0 ₫</span>
			</div>
			<div class="chart-columns">
				{#each months as month, i}<div class="chart-column">
						<div class="bar-track">
							<div
								class:today={i === MONTHS_SHOWN - 1}
								class="bar"
								style:height={`${Math.max(month.value ? 3 : 0, (month.value / max) * 100)}%`}
							>
								<span class="bar-tooltip">{month.label}<br />{currency(month.value)}</span>
							</div>
						</div>
						<span class:today-label={i === MONTHS_SHOWN - 1}
							>{i === MONTHS_SHOWN - 1 ? 'Tháng này' : month.label}</span
						>
					</div>{/each}
			</div>
		</div>
	</section>
	<SpendingCalendar bills={appState.bills} />
	<section class="panel recent-panel">
		<div class="panel-heading">
			<div>
				<h2>Hóa đơn gần đây</h2>
			</div>
			<a class="text-link" href="/activity">Xem tất cả <ArrowRight size={15} /></a>
		</div>
		<div class="bill-list">
			{#each recentBills as bill, i}<a class="bill-row" href={`/activity?bill=${bill.id}`}
					><span class="bill-symbol tone-{i % 3}"
						>{#if i % 3 === 0}<Utensils size={21} />{:else if i % 3 === 1}<Coffee
								size={21}
							/>{:else}<ReceiptText size={21} />{/if}</span
					>
					<div class="bill-info">
						<strong>{bill.description}</strong><span
							>{appState.members.find((m) => m.id === bill.organizer)?.name} đã trả
							<span class="middot">·</span>
							{dateLabel(bill.date)}</span
						>
					</div>
					<div class="bill-row-right">
						<strong>{currency(bill.total)}</strong>
						<div class="avatar-stack">
							{#each bill.lines.slice(0, 3) as line}<Avatar
									member={appState.members.find((m) => m.id === line.memberId)}
									size="small"
								/>{/each}<small>{bill.lines.length} người</small>
						</div>
					</div>
					<ChevronRight size={16} /></a
				>{/each}
		</div>
	</section>
	<section class="panel balance-peek">
		<div class="panel-heading">
			<div>
				<h2>Lịch sử nợ của bạn</h2>
			</div>
			<Wallet size={19} />
		</div>
		<div class="balance-peek-list">
			{#each [...pairs].sort((a, b) => Math.abs(b.balance) - Math.abs(a.balance)).slice(0, 4) as pair}<a
					href="/balances"
					class="balance-peek-row"
					><Avatar member={pair.member} />
					<div>
						<strong>{pair.member.name}</strong>
					</div>
					<strong class:loss-amount={pair.balance < 0} class:gain-amount={pair.balance > 0}
						>{currency(Math.abs(pair.balance))}</strong
					></a
				>{/each}
		</div>
		<a href="/balances" class="panel-bottom-link">Xem chi tiết & thanh toán <ArrowRight size={16} /></a>
	</section>
</div>
