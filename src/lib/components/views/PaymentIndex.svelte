<script lang="ts">
	import type { AppState } from '$lib/domain/types';
	import { currency, localDate, netBalance } from '$lib/domain/ledger';
	import { tickerCodes } from '$lib/domain/ticker';
	import Avatar from '../Avatar.svelte';
	let { appState }: { appState: AppState; actor: string } = $props();
	// Bright, distinguishable series colours for the black "price board".
	const BOARD_COLORS = [
		'#4f9cf9',
		'#f0524f',
		'#f5c242',
		'#2fbf71',
		'#ff8c2a',
		'#3fc6d6',
		'#9b8cff',
		'#ff7a8a',
		'#e8e05a',
		'#6fd08c',
		'#ff5fd2',
		'#5ad1e6'
	];
	const CHART = { width: 900, height: 820, left: 70, right: 30, top: 34, bottom: 52 };
	const number = new Intl.NumberFormat('vi-VN');
	let range = $state(15);
	let metricScope = $state('all');
	let hidden = $state<string[]>([]);
	const members = $derived(appState.members.filter((m) => metricScope === 'all' || m.active));
	const codes = $derived(tickerCodes(appState.members));
	const colorOf = $derived(
		Object.fromEntries(appState.members.map((m, i) => [m.id, BOARD_COLORS[i % BOARD_COLORS.length]]))
	);
	const dates = $derived(
		Array.from({ length: range }, (_, i) => {
			const date = new Date();
			date.setDate(date.getDate() - range + 1 + i);
			return localDate(date);
		})
	);
	const history = $derived(
		members.map((member) => ({
			member,
			values: dates.map((date) =>
				netBalance(
					appState.ledger.filter((e) => localDate(e.date) <= date),
					member.id
				)
			)
		}))
	);
	const rows = $derived(
		dates
			.map((date, i) => {
				const values = history.map((h) => h.values[i]);
				return { date, values, high: Math.max(...values), low: Math.min(...values) };
			})
			.reverse()
	);
	const tone = (value: number, high: number, low: number) =>
		value === 0
			? 'ref'
			: value === high && value > 0
				? 'ceiling'
				: value === low && value < 0
					? 'floor'
					: value > 0
						? 'up'
						: 'down';
	const series = $derived(history.filter((h) => !hidden.includes(h.member.id)));
	const all = $derived(series.flatMap((s) => s.values));
	const min = $derived(Math.min(0, ...all));
	const max = $derived(Math.max(1, ...all));
	const y = (value: number) =>
		CHART.top + ((max - value) / (max - min || 1)) * (CHART.height - CHART.top - CHART.bottom);
	const x = (index: number) =>
		CHART.left + (index / Math.max(1, range - 1)) * (CHART.width - CHART.left - CHART.right);
	const ticks = $derived.by(() => {
		const step = 10 ** Math.floor(Math.log10(Math.max(1, (max - min) / 4)));
		const nice = [1, 2, 2.5, 5, 10].map((f) => f * step).find((s) => (max - min) / s <= 6) ?? step * 10;
		const values = [];
		for (let v = Math.ceil(min / nice) * nice; v <= max; v += nice) values.push(v);
		return values;
	});
	const positive = $derived(
		members
			.map((member) => ({ member, net: netBalance(appState.ledger, member.id) }))
			.filter((p) => p.net > 0)
			.sort((a, b) => b.net - a.net)
	);
	const positiveTotal = $derived(positive.reduce((s, p) => s + p.net, 0));
	const slices = $derived.by(() => {
		let angle = -Math.PI / 2;
		return positive.map((p) => {
			const sweep = (p.net / positiveTotal) * Math.PI * 2;
			const start = angle;
			angle += sweep;
			const point = (a: number, r = 1) => `${Math.cos(a) * r},${Math.sin(a) * r}`;
			const mid = start + sweep / 2;
			return {
				...p,
				share: p.net / positiveTotal,
				path:
					sweep >= Math.PI * 2 - 1e-9
						? 'M 0,-1 A 1,1 0 1 1 -0.0001,-1 Z'
						: `M 0,0 L ${point(start)} A 1,1 0 ${sweep > Math.PI ? 1 : 0} 1 ${point(angle)} Z`,
				labelX: Math.cos(mid) * 0.62,
				labelY: Math.sin(mid) * 0.62
			};
		});
	});
	const today = localDate(new Date());
	const actualPayments = $derived(
		appState.ledger.filter((e) => e.type === 'payment' && e.source !== 'settlement' && e.from !== e.to)
	);
	const sum = (predicate: (e: (typeof actualPayments)[number]) => boolean) =>
		actualPayments.filter(predicate).reduce((s, e) => s + e.amount, 0);
	const stats = $derived(
		members.map((member) => ({
			member,
			paid: sum((e) => e.from === member.id),
			received: sum((e) => e.to === member.id),
			paidToday: sum((e) => e.from === member.id && localDate(e.date) === today),
			receivedToday: sum((e) => e.to === member.id && localDate(e.date) === today),
			net: netBalance(appState.ledger, member.id)
		}))
	);
	const dayLabel = (date: string) => `${date.slice(8)}/${date.slice(5, 7)}/${date.slice(0, 4)}`;
	const showPointLabel = (values: number[], i: number) =>
		i === 0 || i === values.length - 1 || values[i] !== values[i - 1];
	function toggle(id: string) {
		hidden = hidden.includes(id) ? hidden.filter((v) => v !== id) : [...hidden, id];
	}
</script>

<div class="page-heading">
	<div>
		<h1>Tiền ăn index</h1>
		<p>Lãi - lỗ cuối ngày của từng mã · Số dương: lỗ (được nợ) · Số âm: lãi (đang nợ)</p>
	</div>
	<div class="index-controls">
		<select aria-label="Phạm vi chỉ số" bind:value={metricScope}
			><option value="all">Gồm thành viên cũ</option><option value="active">Đang hoạt động</option></select
		><select aria-label="Khoảng thời gian" bind:value={range}
			><option value={7}>7 ngày</option><option value={15}>15 ngày</option><option value={30}>30 ngày</option
			></select
		>
	</div>
</div>
<div class="ticker-board">
	<div class="ticker-left">
		<section class="ticker-card" aria-label="Bảng giá các mã">
			<div class="ticker-table-scroll">
				<table class="ticker-table">
					<thead
						><tr
							><th>Ngày</th>{#each members as member}<th title={member.name}>{codes[member.id]}</th
								>{/each}</tr
						></thead
					><tbody
						>{#each rows as row}<tr
								><th>{dayLabel(row.date)}</th>{#each row.values as value}<td
										class={tone(value, row.high, row.low)}>{number.format(value)}</td
									>{/each}</tr
							>{/each}</tbody
					>
				</table>
			</div>
		</section>
		<section class="ticker-card ticker-pie">
			<h2>Tỉ trọng các mã có vốn hoá dương</h2>
			{#if positive.length}<div class="pie-layout">
					<svg viewBox="-1.05 -1.05 2.1 2.1" role="img" aria-label="Tỉ trọng các mã có vốn hoá dương"
						>{#each slices as slice}<path d={slice.path} fill={colorOf[slice.member.id]}
								><title>{codes[slice.member.id]}: {currency(slice.net)}</title></path
							>{#if slice.share >= 0.06}<text x={slice.labelX} y={slice.labelY} class="pie-label"
									>{codes[slice.member.id]}</text
								>{/if}{/each}</svg
					>
					<ul>
						{#each slices as slice}<li>
								<span style:background={colorOf[slice.member.id]}></span><strong
									>{codes[slice.member.id]}</strong
								><small>{Math.round(slice.share * 1000) / 10}%</small>
							</li>{/each}
					</ul>
				</div>{:else}<p class="ticker-empty">Không có mã nào có vốn hoá dương.</p>{/if}
		</section>
	</div>
	<section class="ticker-card ticker-chart">
		<h2>Chỉ số các mã ĂT trong vòng {range} ngày</h2>
		<div class="ticker-legend">
			{#each members as member}<button
					class:muted={hidden.includes(member.id)}
					aria-pressed={!hidden.includes(member.id)}
					title={member.name}
					onclick={() => toggle(member.id)}
					><span style:background={colorOf[member.id]}></span>{codes[member.id]}</button
				>{/each}
		</div>
		<svg
			viewBox={`0 0 ${CHART.width} ${CHART.height}`}
			role="img"
			aria-label={`Chỉ số các mã trong ${range} ngày`}
			>{#each ticks as tick}<line
					x1={CHART.left}
					x2={CHART.width - CHART.right}
					y1={y(tick)}
					y2={y(tick)}
					class:zero-line={tick === 0}
					class="grid-line"
				/><text x={CHART.left - 8} y={y(tick) + 4} text-anchor="end" class="axis-label"
					>{number.format(Math.round(tick / 1000))}k</text
				>{/each}{#each dates as date, i}{#if i % Math.ceil(range / 7) === 1 || range <= 7}<line
						x1={x(i)}
						x2={x(i)}
						y1={CHART.top}
						y2={CHART.height - CHART.bottom}
						class="grid-line"
					/><text x={x(i)} y={CHART.height - 18} text-anchor="middle" class="axis-label date-label"
						>{dayLabel(date)}</text
					>{/if}{/each}{#each series as line}<polyline
					points={line.values.map((v, i) => `${x(i)},${y(v)}`).join(' ')}
					fill="none"
					stroke={colorOf[line.member.id]}
					stroke-width="3"
					stroke-linejoin="round"
				/>{#each line.values as value, i}<circle cx={x(i)} cy={y(value)} r="5" fill={colorOf[line.member.id]}
						><title>{codes[line.member.id]} · {dayLabel(dates[i])}: {currency(value)}</title></circle
					>{#if showPointLabel(line.values, i)}<text
							x={x(i)}
							y={y(value) - 11}
							text-anchor="middle"
							class="point-label"
							fill={colorOf[line.member.id]}>{number.format(Math.round(value / 1000))}k</text
						>{/if}{/each}{/each}</svg
		>{#if !series.length}<p class="ticker-empty">Chọn ít nhất một mã để xem biểu đồ.</p>{/if}
	</section>
</div>
<section class="panel">
	<div class="panel-heading">
		<div>
			<h2>Tổng hợp hoàn tiền</h2>
			<p>Chỉ các khoản trả tiền được ghi nhận · Không gồm bản ghi tối giản nợ</p>
		</div>
	</div>
	<div class="table-scroll">
		<table class="data-table">
			<thead
				><tr
					><th>Mã</th><th>Thành viên</th><th class="align-right">Đã trả</th><th class="align-right"
						>Đã nhận</th
					><th class="align-right">Trả hôm nay</th><th class="align-right">Nhận hôm nay</th><th
						class="align-right">Lỗ/lãi</th
					></tr
				></thead
			><tbody
				>{#each stats as row}<tr
						><td><strong class="ticker-code">{codes[row.member.id]}</strong></td><td
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
