<script lang="ts">
	import { TrendingUp, ArrowUpRight, ArrowDownLeft, CalendarDays, Info } from '@lucide/svelte';
	import type { AppState } from '$lib/domain/types';
	import { currency, shortCurrency, localDate, netBalance } from '$lib/domain/ledger';
	import Avatar from '../Avatar.svelte';
	let { appState, actor }: { appState: AppState; actor: string } = $props();
	let range = $state(15);
	let selected = $state<string[]>([]);
	$effect(() => {
		selected = [actor];
	});
	let metricScope = $state('all');
	const members = $derived(appState.members.filter((m) => metricScope === 'all' || m.active));
	const dates = $derived(
		Array.from({ length: range }, (_, i) => {
			const date = new Date();
			date.setDate(date.getDate() - range + 1 + i);
			return localDate(date);
		})
	);
	const series = $derived(
		members
			.filter((m) => selected.includes(m.id))
			.map((member) => ({
				member,
				values: dates.map((date) =>
					netBalance(
						appState.ledger.filter((e) => localDate(e.date) <= date),
						member.id
					)
				)
			}))
	);
	const min = $derived(Math.min(0, ...series.flatMap((s) => s.values)));
	const max = $derived(Math.max(1, ...series.flatMap((s) => s.values)));
	const y = (value: number) => 25 + ((max - value) / (max - min || 1)) * 200;
	const x = (index: number) => 70 + (index / (range - 1)) * 710;
	const receivables = $derived(
		members
			.map((member) => ({ member, net: netBalance(appState.ledger, member.id) }))
			.filter((p) => p.net > 0)
			.sort((a, b) => b.net - a.net)
	);
	const receivableTotal = $derived(receivables.reduce((s, p) => s + p.net, 0));
	const segments = $derived.by(() => {
		let cursor = 0;
		return receivables
			.map((p) => {
				const start = cursor;
				cursor += (p.net / receivableTotal) * 100;
				return `${p.member.color} ${start}% ${cursor}%`;
			})
			.join(',');
	});
	const today = localDate(new Date());
	const actualPayments = $derived(
		appState.ledger.filter((e) => e.type === 'payment' && e.source !== 'settlement')
	);
	const stats = $derived(
		members.map((member) => ({
			member,
			paid: actualPayments
				.filter((e) => e.from === member.id && e.from !== e.to)
				.reduce((s, e) => s + e.amount, 0),
			received: actualPayments
				.filter((e) => e.to === member.id && e.from !== e.to)
				.reduce((s, e) => s + e.amount, 0),
			paidToday: actualPayments
				.filter((e) => e.from === member.id && e.from !== e.to && localDate(e.date) === today)
				.reduce((s, e) => s + e.amount, 0),
			receivedToday: actualPayments
				.filter((e) => e.to === member.id && e.from !== e.to && localDate(e.date) === today)
				.reduce((s, e) => s + e.amount, 0),
			net: netBalance(appState.ledger, member.id)
		}))
	);
	function toggle(id: string) {
		selected = selected.includes(id) ? selected.filter((v) => v !== id) : [...selected, id];
	}
</script>

<div class="page-heading">
	<div>
		<h1>Tiền ăn index</h1>
		<p>Số dư theo ngày và các khoản hoàn tiền đã được ghi nhận.</p>
	</div>
	<select aria-label="Phạm vi chỉ số" bind:value={metricScope}
		><option value="all">Gồm thành viên cũ</option><option value="active">Đang hoạt động</option></select
	>
</div>
<section class="panel index-chart-panel">
	<div class="panel-heading">
		<div>
			<h2>Diễn biến lỗ/lãi</h2>
			<p>Số dương: lỗ · Số âm: lãi · Số dư cuối ngày theo giờ Việt Nam</p>
		</div>
		<select aria-label="Khoảng thời gian biểu đồ" bind:value={range}
			><option value={7}>7 ngày gần nhất</option><option value={15}>15 ngày gần nhất</option><option
				value={30}>30 ngày gần nhất</option
			></select
		>
	</div>
	<div class="chart-legend">
		{#each members as member}<button
				class:muted={!selected.includes(member.id)}
				onclick={() => toggle(member.id)}
				aria-pressed={selected.includes(member.id)}
				><span style:background={member.color}></span>{member.name}</button
			>{/each}
	</div>
	<div class="line-chart-container">
		<svg viewBox="0 0 810 270" role="img" aria-label="Biểu đồ lỗ/lãi của các thành viên được chọn"
			>{#each [max, (max + min) / 2, min] as value}<line
					x1="70"
					x2="780"
					y1={y(value)}
					y2={y(value)}
					stroke="#e9e9e1"
					stroke-dasharray="4 5"
				/><text x="57" y={y(value) + 4} text-anchor="end" class="chart-axis">{shortCurrency(value)}</text
				>{/each}<line x1="70" x2="780" y1={y(0)} y2={y(0)} stroke="#c4ccbf" />{#each series as line}<polyline
					points={line.values.map((v, i) => `${x(i)},${y(v)}`).join(' ')}
					fill="none"
					stroke={line.member.color}
					stroke-width="2.5"
					stroke-linejoin="round"
				/>{#each line.values as value, i}<circle cx={x(i)} cy={y(value)} r="3" fill={line.member.color}
						><title>{line.member.name} · {dates[i]}: {currency(value)}</title></circle
					>{/each}{/each}{#each dates as date, i}{#if i === 0 || i === range - 1 || i % Math.ceil(range / 5) === 0}<text
						x={x(i)}
						y="253"
						text-anchor="middle"
						class="chart-axis">{date.slice(8)}/{date.slice(5, 7)}</text
					>{/if}{/each}</svg
		>{#if !series.length}<p class="chart-empty">Chọn ít nhất một thành viên để xem biểu đồ.</p>{/if}
	</div>
</section>
<div class="index-bottom-grid">
	<section class="panel">
		<div class="panel-heading">
			<div>
				<h2>Tỷ trọng lỗ</h2>
				<p>Các thành viên có số dư ròng dương</p>
			</div>
		</div>
		<div class="donut-layout">
			<div
				class="donut-chart"
				style:background={receivableTotal ? `conic-gradient(${segments})` : '#eeeee7'}
				role="img"
				aria-label="Tỷ trọng lỗ"
			>
				<div><small>Tổng lỗ</small><strong>{shortCurrency(receivableTotal)}</strong></div>
			</div>
			<div class="donut-legend">
				{#each receivables as position}<div>
						<span style:background={position.member.color}></span><strong>{position.member.name}</strong
						><small>{Math.round((position.net / receivableTotal) * 100)}%</small>
					</div>{/each}{#if !receivables.length}<p>Không có số dư dương.</p>{/if}
			</div>
		</div>
	</section>
	<section class="panel info-panel">
		<span class="feature-icon"><TrendingUp size={23} /></span>
		<h2>Hiểu đúng số dư</h2>
		<p>Lỗ là số tiền người khác nợ bạn; lãi là số tiền bạn còn nợ người khác.</p>
		<p>Các bút toán điều phối giữ nguyên số dư ròng và được loại khỏi thống kê hoàn tiền thực tế.</p>
		<div class="notice">
			<Info size={17} />
			<p>
				Bộ lọc thành viên chỉ thay đổi người được hiển thị. Số dư từng người luôn tính từ toàn bộ lịch sử.
			</p>
		</div>
	</section>
</div>
<section class="panel">
	<div class="panel-heading">
		<div>
			<h2>Tổng hợp hoàn tiền</h2>
			<p>Chỉ các khoản trả tiền được ghi nhận · Không gồm bút toán điều phối</p>
		</div>
	</div>
	<div class="table-scroll">
		<table class="data-table">
			<thead
				><tr
					><th>Thành viên</th><th class="align-right">Đã trả</th><th class="align-right">Đã nhận</th><th
						class="align-right">Trả hôm nay</th
					><th class="align-right">Nhận hôm nay</th><th class="align-right">Lỗ/lãi</th></tr
				></thead
			><tbody
				>{#each stats as row}<tr
						><td
							><div class="table-person">
								<Avatar member={row.member} size="small" /><span
									>{row.member.name}{#if !row.member.active}<small>Thành viên cũ</small>{/if}</span
								>
							</div></td
						><td class="align-right">{currency(row.paid)}</td><td class="align-right"
							>{currency(row.received)}</td
						><td class="align-right">{currency(row.paidToday)}</td><td class="align-right"
							>{currency(row.receivedToday)}</td
						><td
							class="align-right amount-cell"
							class:loss-amount={row.net >= 0}
							class:gain-amount={row.net < 0}>{currency(row.net)}</td
						></tr
					>{/each}</tbody
			>
		</table>
	</div>
</section>
