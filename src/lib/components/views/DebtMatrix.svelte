<script lang="ts">
	import { ArrowRight, Network, ShieldCheck, Info, Clock } from '@lucide/svelte';
	import { Button } from '$lib/components/ui/button';
	import Modal from '../Modal.svelte';
	import Avatar from '../Avatar.svelte';
	import type { AppState, SettlementPlan } from '$lib/domain/types';
	import type { RunCommand } from '$lib/client/types';
	import { currency, pairBalance, netBalance, settlementPlan, dateLabel } from '$lib/domain/ledger';
	let { appState, actor, run, busy }: { appState: AppState; actor: string; run: RunCommand; busy: boolean } =
		$props();
	let scope = $state('all');
	let confirmOpen = $state(false);
	let plan = $state<SettlementPlan | null>(null);
	let planError = $state('');
	const members = $derived(appState.members.filter((m) => scope === 'all' || m.active));
	const isAdmin = $derived(appState.members.find((m) => m.id === actor)?.role === 'admin');
	const relationships = $derived(
		members
			.flatMap((a, i) =>
				members
					.slice(i + 1)
					.map((b) => ({ from: a.id, to: b.id, amount: pairBalance(appState.ledger, a.id, b.id) }))
			)
			.filter((p) => p.amount !== 0)
	);
	const outstanding = $derived(relationships.reduce((sum, p) => sum + Math.abs(p.amount), 0));
	const hubName = $derived(appState.members.find((m) => m.id === plan?.hub)?.name ?? '');
	const previewPositions = $derived(
		plan
			? appState.members
					.map((m) => ({ member: m, net: netBalance(appState.ledger, m.id) }))
					.filter((p) => p.net !== 0 && p.member.id !== plan!.hub)
			: []
	);
	function preview() {
		planError = '';
		try {
			plan = settlementPlan(appState);
			confirmOpen = true;
		} catch (error) {
			planError = (error as Error).message;
		}
	}
	async function commit() {
		if (plan)
			try {
				await run(
					'settleDebts',
					{ id: crypto.randomUUID(), version: plan.version },
					'Đã tối giản nợ; lãi - lỗ của từng người được giữ nguyên.'
				);
				confirmOpen = false;
			} catch {}
	}
</script>

<div class="page-heading">
	<div>
		<h1>Ma trận nợ nần</h1>
	</div>
</div>
<div class="stat-grid">
	<div class="stat-card">
		<div class="stat-label">Tổng nợ giữa các cặp <Network size={18} /></div>
		<strong>{currency(outstanding)}</strong><span class="stat-foot"
			>{scope === 'all' ? 'Bao gồm toàn bộ thành viên' : 'Chỉ các quan hệ trong nhóm đang hoạt động'}</span
		>
	</div>
	<div class="stat-card">
		<div class="stat-label">Khoản nợ đang mở <ArrowRight size={18} /></div>
		<strong>{relationships.length}<span class="stat-unit"> cặp</span></strong><span class="stat-foot"
			>Sau khi đối trừ hai chiều</span
		>
	</div>
	<div class="stat-card">
		<div class="stat-label">Tổng lỗ/lãi <ShieldCheck size={18} /></div>
		<strong class="positive"
			>{currency(appState.members.reduce((s, m) => s + netBalance(appState.ledger, m.id), 0))}</strong
		><span class="stat-foot">Phải luôn bằng 0 trên toàn bộ lịch sử</span>
	</div>
</div>
{#if planError}<p class="notice warm" role="alert"><Clock size={18} />{planError}</p>{/if}
<section class="panel matrix-panel">
	<div class="panel-heading">
		<div>
			<h2>Nợ theo thành viên</h2>
			<p>Số dương: người ở hàng nợ người ở cột · Số âm: người ở cột nợ người ở hàng · Đơn vị: đồng</p>
		</div>
		<select aria-label="Phạm vi ma trận" bind:value={scope}
			><option value="all">Tất cả, gồm thành viên cũ</option><option value="active"
				>Thành viên đang hoạt động</option
			></select
		>
	</div>
	<div class="table-scroll">
		<table class="matrix-table">
			<thead
				><tr
					><th>Người nợ ↓ / Người nhận →</th>{#each members as member}<th
							><Avatar {member} size="small" /><span>{member.name.split(' ').slice(-1)[0]}</span></th
						>{/each}<th>Lãi - lỗ*</th></tr
				></thead
			><tbody
				>{#each members as row}<tr
						><th
							><span>{row.name}</span>{#if !row.active}<small>Thành viên cũ</small>{/if}</th
						>{#each members as column}{@const balance = pairBalance(appState.ledger, row.id, column.id)}<td
								class:self-cell={row.id === column.id}
								class:debt-cell={balance > 0}
								class:credit-cell={balance < 0}
								title={`${row.name} → ${column.name}: ${currency(balance)}`}
								>{row.id === column.id
									? '—'
									: balance
										? new Intl.NumberFormat('vi-VN').format(balance)
										: '·'}</td
							>{/each}<td
							class:loss-amount={netBalance(appState.ledger, row.id) >= 0}
							class:gain-amount={netBalance(appState.ledger, row.id) < 0}
							class="matrix-net">{currency(netBalance(appState.ledger, row.id))}</td
						></tr
					>{/each}</tbody
			>
		</table>
	</div>
	<div class="table-footer">
		<span>* Lãi - lỗ luôn tính từ toàn bộ lịch sử. Dương: lỗ. Âm: lãi.</span>
	</div>
</section>
{#if isAdmin}<Button class="simplify-button" onclick={preview} disabled={busy}
		><Network size={20} /> Tối giản nợ</Button
	>{/if}
<div class="two-panels">
	<section class="panel info-panel">
		<span class="feature-icon"><Network size={22} /></span>
		<h2>Quy tắc tối giản</h2>
		<p>
			Tối giản nợ cân bằng các khoản nợ hiện tại về 0 rồi chuyển chúng qua người phân phối tiền: người có lãi
			- lỗ thấp nhất. Lãi - lỗ của từng người giữ nguyên.
		</p>
		<div class="notice">
			<Info size={17} />
			<p>Đây là bản ghi đổi quan hệ nợ, không phải chuyển tiền.</p>
		</div>
		{#if !isAdmin}<p class="fine-print">Chỉ quản trị viên được tối giản nợ.</p>{/if}
	</section>
	<section class="panel">
		<div class="panel-heading">
			<h2>Lịch sử tối giản</h2>
			<span class="mini-pill">{appState.settlements.length} lần</span>
		</div>
		{#each [...appState.settlements].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 5) as batch}<div
				class="settlement-history"
			>
				<span class="stat-icon"><Network size={17} /></span>
				<div>
					<strong>Người phân phối tiền: {appState.members.find((m) => m.id === batch.hub)?.name}</strong
					><small>{dateLabel(batch.date)} · {batch.entryCount} bản ghi trong Ledger</small>
				</div>
			</div>{/each}{#if !appState.settlements.length}<div class="inline-empty">
				Chưa có lần tối giản nào. Các khoản nợ vẫn giữ quan hệ ban đầu.
			</div>{/if}
	</section>
</div>
<Modal
	bind:open={confirmOpen}
	title="Xem lại phương án tối giản nợ"
	description="Phạm vi luôn bao gồm tất cả thành viên, kể cả thành viên cũ."
	wide
	>{#if plan}<div class="notice">
			<ShieldCheck size={20} />
			<p>
				Người phân phối tiền: <strong>{hubName}</strong>. Thêm {plan.entries.length} bản ghi trong Ledger.
			</p>
		</div>
		<h3>Các khoản nợ sau tối giản</h3>
		<div class="review-lines">
			{#each previewPositions as position}<div>
					<span
						><strong
							>{position.net < 0 ? position.member.name : hubName} → {position.net < 0
								? hubName
								: position.member.name}</strong
						><small>Lãi - lỗ của {position.member.name}: {currency(position.net)}</small></span
					><strong>{currency(Math.abs(position.net))}</strong>
				</div>{/each}
		</div>
		<div class="modal-actions">
			<Button variant="outline" onclick={() => (confirmOpen = false)}>Hủy</Button><Button
				disabled={busy || !plan.entries.length}
				onclick={commit}>Xác nhận tối giản</Button
			>
		</div>{/if}</Modal
>
