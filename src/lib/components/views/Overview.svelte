<script lang="ts">
	import {
		Plus,
		ArrowUpRight,
		ArrowDownLeft,
		ArrowRight,
		Wallet,
		ReceiptText,
		Utensils,
		Leaf,
		ChevronRight,
		CalendarDays,
		Coffee
	} from '@lucide/svelte';
	import { Button } from '$lib/components/ui/button';
	import Avatar from '../Avatar.svelte';
	import type { AppState } from '$lib/domain/types';
	import { currency, shortCurrency, pairBalance, netBalance, dateLabel, localDate } from '$lib/domain/ledger';
	let { appState, actor }: { appState: AppState; actor: string } = $props();
	const member = $derived(appState.members.find((m) => m.id === actor)!);
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
	const meal = $derived(appState.meals.find((m) => m.date === localDate(new Date())) || appState.meals[0]);
</script>

<div class="page-heading">
	<div>
		<div class="eyebrow">BỮA TRƯA CỦA CHÚNG MÌNH</div>
		<h1>
			Chào {member.name.split(' ').slice(-1)[0]}, hôm nay ăn gì?
			<span class="greeting-leaf"><Leaf size={27} /></span>
		</h1>
		<p>Mọi bữa ăn, mọi khoản chia. Gọn gàng ở đây.</p>
	</div>
	<Button href="/new-bill" class="primary-action"><Plus size={18} /> Tạo hóa đơn</Button>
</div>
<div class="stat-grid">
	<div class="stat-card">
		<div class="stat-label">
			Chi tiêu của nhóm tháng này <span class="stat-icon"><Utensils size={17} /></span>
		</div>
		<strong>{currency(monthSpend)}</strong><span class="stat-foot"
			><span class="mini-pill">{monthBills.length} hóa đơn</span> Những bữa ngon đã cùng chia</span
		>
	</div>
	<div class="stat-card">
		<div class="stat-label">
			Bạn được nhận <span class="stat-icon green"><ArrowDownLeft size={17} /></span>
		</div>
		<strong class="positive">{currency(owed)}</strong><span class="stat-foot"
			>Từ {pairs.filter((p) => p.balance < 0).length} thành viên
			<a href="/balances" aria-label="Xem khoản được nhận"><ArrowUpRight size={16} /></a></span
		>
	</div>
	<div class="stat-card">
		<div class="stat-label">Bạn cần trả <span class="stat-icon orange"><ArrowUpRight size={17} /></span></div>
		<strong class="negative">{currency(owing)}</strong><span class="stat-foot"
			>Cho {pairs.filter((p) => p.balance > 0).length} thành viên
			<a href="/balances" aria-label="Xem khoản cần trả"><ArrowUpRight size={16} /></a></span
		>
	</div>
</div>
<div class="overview-grid">
	<section class="panel spending-panel">
		<div class="panel-heading">
			<div>
				<h2>Những bữa ăn trong tuần</h2>
				<p>Chi tiêu chung trong 7 ngày gần nhất</p>
			</div>
			<span class="subtle-label"><CalendarDays size={14} /> 7 ngày qua</span>
		</div>
		<div class="spending-summary">
			<strong>{currency(days.reduce((s, d) => s + d.value, 0))}</strong><span>cả đội đã cùng chia</span>
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
	<section class="meal-feature">
		<div class="meal-topline">
			<span><Leaf size={15} /> GỢI Ý TRONG TUẦN</span><span class="meal-number">01 / 05</span>
		</div>
		<div class="plate-illustration" aria-hidden="true">
			<div class="plate-inner">
				<span class="rice"></span><span class="vegetable v1"></span><span class="vegetable v2"></span><span
					class="vegetable v3"
				></span><span class="food f1"></span><span class="food f2"></span><span class="food f3"></span>
			</div>
			<span class="chopstick c1"></span><span class="chopstick c2"></span>
		</div>
		<div class="meal-feature-text">
			<span class="small-caps">MỘT BỮA NGON ĐANG CHỜ</span>
			<h2>{meal?.dish || 'Cơm gà Hội An'}</h2>
			<p>{meal?.note || 'Một chút cảm hứng cho bữa trưa của đội.'}</p>
			<a href="/meals">Khám phá thực đơn <ArrowRight size={17} /></a>
		</div>
	</section>
	<section class="panel recent-panel">
		<div class="panel-heading">
			<div>
				<h2>Hóa đơn gần đây</h2>
				<p>Chuyện ăn uống của cả đội</p>
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
				<h2>Công nợ của bạn</h2>
				<p>Đã đối trừ hai chiều</p>
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
							>{pair.balance > 0 ? 'Bạn cần trả' : 'Bạn được nhận'}</small
						>
					</div>
					<strong class:positive={pair.balance < 0} class:negative={pair.balance > 0}
						>{currency(Math.abs(pair.balance))}</strong
					></a
				>{/each}
		</div>
		<a href="/balances" class="panel-bottom-link">Xem chi tiết & thanh toán <ArrowRight size={16} /></a>
	</section>
</div>
<div class="gentle-note">
	<span class="note-mark"><Leaf size={22} /></span>
	<p>
		<strong>Ăn cùng nhau. Tính tiền nhẹ nhàng.</strong> Chi phí của bạn được giữ trong hóa đơn, không tạo khoản
		nợ cho chính mình.
	</p>
	<span class="note-people"
		>{#each appState.members.filter((m) => m.active).slice(0, 4) as member}<Avatar
				{member}
				size="small"
			/>{/each}<span>+{Math.max(0, appState.members.filter((m) => m.active).length - 4)}</span></span
	>
</div>
