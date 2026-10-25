<script lang="ts">
	import {
		Plus,
		ArrowUpRight,
		ArrowDownLeft,
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
	import type { AppState } from '$lib/domain/types';
	import { currency, shortCurrency, pairBalance, netBalance, dateLabel, localDate } from '$lib/domain/ledger';
	let { appState, actor }: { appState: AppState; actor: string } = $props();
	const pairs = $derived(
		appState.members
			.filter((m) => m.id !== actor)
			.map((m) => ({ member: m, balance: pairBalance(appState.ledger, actor, m.id) }))
			.filter((p) => p.balance !== 0)
	);
	const owed = $derived(pairs.reduce((s, p) => s + Math.max(0, -p.balance), 0));
	const owing = $derived(pairs.reduce((s, p) => s + Math.max(0, p.balance), 0));
	const currentMonth = localDate(new Date()).slice(0, 7);
	const monthBills = $derived(appState.bills.filter((b) => localDate(b.date).startsWith(currentMonth)));
	const monthSpend = $derived(monthBills.reduce((s, b) => s + b.total, 0));
	const recentBills = $derived([...appState.bills].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 4));
	const days = $derived(
		Array.from({ length: 7 }, (_, i) => {
			const date = new Date();
			date.setDate(date.getDate() - 6 + i);
			const key = localDate(date);
			return {
				key,
				label: new Intl.DateTimeFormat('vi-VN', { weekday: 'short', timeZone: 'Asia/Ho_Chi_Minh' }).format(
					date
				),
				value: appState.bills.filter((b) => localDate(b.date) === key).reduce((s, b) => s + b.total, 0)
			};
		})
	);
	const max = $derived(Math.max(1, ...days.map((d) => d.value)));
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
	<div class="stat-card">
		<div class="stat-label">
			Bạn đang lỗ <span class="stat-icon orange"><ArrowDownLeft size={17} /></span>
		</div>
		<strong class="loss-amount">{currency(owed)}</strong><span class="stat-foot"
			>Từ {pairs.filter((p) => p.balance < 0).length} thành viên
			<a href="/balances" aria-label="Xem khoản lỗ"><ArrowUpRight size={16} /></a></span
		>
	</div>
	<div class="stat-card">
		<div class="stat-label">
			Bạn đang lãi <span class="stat-icon green"><ArrowUpRight size={17} /></span>
		</div>
		<strong class="gain-amount">{currency(owing)}</strong><span class="stat-foot"
			>Cho {pairs.filter((p) => p.balance > 0).length} thành viên
			<a href="/balances" aria-label="Xem khoản lãi"><ArrowUpRight size={16} /></a></span
		>
	</div>
</div>
<div class="overview-grid">
	<section class="panel spending-panel">
		<div class="panel-heading">
			<div>
				<h2>Chi tiêu 7 ngày</h2>
			</div>
			<span class="subtle-label"><CalendarDays size={14} /> 7 ngày qua</span>
		</div>
		<div class="spending-summary">
			<strong>{currency(days.reduce((s, d) => s + d.value, 0))}</strong>
		</div>
		<div class="bar-chart">
			<div class="chart-grid-lines">
				<span>{shortCurrency(max)}</span><span>{shortCurrency(max / 2)}</span><span>0 ₫</span>
			</div>
			<div class="chart-columns">
				{#each days as day, i}<div class="chart-column">
						<div class="bar-track">
							<div
								class:today={i === 6}
								class="bar"
								style:height={`${Math.max(day.value ? 3 : 0, (day.value / max) * 100)}%`}
							>
								<span class="bar-tooltip"
									>{dateLabel(day.key + 'T12:00:00+07:00')}<br />{currency(day.value)}</span
								>
							</div>
						</div>
						<span class:today-label={i === 6}>{i === 6 ? 'Hôm nay' : day.label}</span>
					</div>{/each}
			</div>
		</div>
	</section>
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
						<strong>{pair.member.name}</strong><small
							>{pair.balance > 0 ? 'Bạn đang lãi' : 'Bạn đang lỗ'}</small
						>
					</div>
					<strong class:loss-amount={pair.balance < 0} class:gain-amount={pair.balance > 0}
						>{currency(Math.abs(pair.balance))}</strong
					></a
				>{/each}
		</div>
		<a href="/balances" class="panel-bottom-link">Xem chi tiết & thanh toán <ArrowRight size={16} /></a>
	</section>
</div>
