<script lang="ts">
	import { ArrowRight, Network, ShieldCheck, RefreshCw, Info, Check, Clock, Users } from '@lucide/svelte';
	import { Button } from '$lib/components/ui/button';
	import Modal from '../Modal.svelte';
	import Avatar from '../Avatar.svelte';
	import type { AppState, SettlementPlan } from '$lib/domain/types';
	import type { RunCommand } from '$lib/client/types';
	import {
		currency,
		shortCurrency,
		pairBalance,
		netBalance,
		settlementPlan,
		dateLabel
	} from '$lib/domain/ledger';
	let { appState, actor, run, busy }: { appState: AppState; actor: string; run: RunCommand; busy: boolean } =
		$props();
	let scope = $state('all');
	let confirmOpen = $state(false);
	let plan = $state<SettlementPlan | null>(null);
	let planError = $state('');
	let acknowledged = $state(false);
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
	const previewPositions = $derived(
		plan
			? appState.members
					.map((m) => ({ member: m, net: netBalance(appState.ledger, m.id) }))
					.filter((p) => p.net !== 0 && p.member.id !== plan!.hub)
			: []
	);
	function preview() {
		planError = '';
		acknowledged = false;
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
					'Đã điều phối công nợ; số dư ròng được giữ nguyên.'
				);
				confirmOpen = false;
			} catch {}
	}
</script>

<div class="page-heading">
	<div>
		<div class="eyebrow">BỨC TRANH CHUNG CỦA CẢ ĐỘI</div>
		<h1>Ma trận công nợ</h1>
		<p>Đọc theo hàng: người ở hàng đang nợ người ở cột.</p>
	</div>
	{#if isAdmin}<Button onclick={preview} disabled={busy}><Network size={17} /> Điều phối công nợ</Button>{/if}
</div>
<div class="stat-grid">
	<div class="stat-card">
		<div class="stat-label">Tổng công nợ giữa các cặp <Network size={18} /></div>
		<strong>{currency(outstanding)}</strong><span class="stat-foot"
			>{scope === 'all' ? 'Bao gồm toàn bộ thành viên' : 'Chỉ các quan hệ trong nhóm đang hoạt động'}</span
		>
	</div>
	<div class="stat-card">
		<div class="stat-label">Quan hệ đang có công nợ <ArrowRight size={18} /></div>
		<strong>{relationships.length}<span class="stat-unit"> cặp</span></strong><span class="stat-foot"
			>Sau khi đối trừ hai chiều</span
		>
	</div>
	<div class="stat-card">
		<div class="stat-label">Tổng số dư ròng <ShieldCheck size={18} /></div>
		<strong class="positive"
			>{currency(appState.members.reduce((s, m) => s + netBalance(appState.ledger, m.id), 0))}</strong
		><span class="stat-foot">Phải luôn bằng 0 trên toàn bộ lịch sử</span>
	</div>
</div>
{#if planError}<p class="notice warm" role="alert"><Clock size={18} />{planError}</p>{/if}
<section class="panel matrix-panel">
	<div class="panel-heading">
		<div>
			<h2>Ai đang nợ ai?</h2>
			<p>Số dương là khoản người ở hàng cần trả · Đơn vị: đồng</p>
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
						>{/each}<th>Số dư ròng*</th></tr
				></thead
			><tbody
				>{#each members as row}<tr
						><th
							><span>{row.name}</span>{#if !row.active}<small>Thành viên cũ</small>{/if}</th
						>{#each members as column}{@const balance = pairBalance(appState.ledger, row.id, column.id)}<td
								class:self-cell={row.id === column.id}
								class:debt-cell={balance > 0}
								title={`${row.name} → ${column.name}: ${currency(Math.max(0, balance))}`}
								>{row.id === column.id
									? '—'
									: balance > 0
										? new Intl.NumberFormat('vi-VN').format(balance)
										: '·'}</td
							>{/each}<td
							class:positive={netBalance(appState.ledger, row.id) >= 0}
							class:negative={netBalance(appState.ledger, row.id) < 0}
							class="matrix-net">{currency(netBalance(appState.ledger, row.id))}</td
						></tr
					>{/each}</tbody
			>
		</table>
	</div>
	<div class="table-footer">
		<span>* Số dư ròng luôn tính từ toàn bộ lịch sử. Dương: được nhận. Âm: cần trả.</span>
	</div>
</section>
<div class="two-panels">
	<section class="panel info-panel">
		<span class="feature-icon"><Network size={22} /></span>
		<h2>Ít mối nợ hơn, dễ theo dõi hơn</h2>
		<p>
			Điều phối sẽ bù trừ các mối nợ hiện tại rồi chuyển chúng qua một đầu mối: người có số dư âm lớn nhất. Số
			dư ròng của từng người giữ nguyên.
		</p>
		<div class="notice">
			<Info size={17} />
			<p>
				Đây là bút toán đổi quan hệ nợ, không phải chuyển tiền và không đảm bảo số lần chuyển khoản ít nhất.
			</p>
		</div>
		{#if !isAdmin}<p class="fine-print">Chỉ quản trị viên được xác nhận điều phối.</p>{/if}
	</section>
	<section class="panel">
		<div class="panel-heading">
			<h2>Lịch sử điều phối</h2>
			<span class="mini-pill">{appState.settlements.length} lần</span>
		</div>
		{#each [...appState.settlements].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 5) as batch}<div
				class="settlement-history"
			>
				<span class="stat-icon"><Network size={17} /></span>
				<div>
					<strong>Đầu mối: {appState.members.find((m) => m.id === batch.hub)?.name}</strong><small
						>{dateLabel(batch.date)} · {batch.entryCount} bút toán</small
					>
				</div>
			</div>{/each}{#if !appState.settlements.length}<div class="inline-empty">
				Chưa có lần điều phối nào. Các khoản nợ vẫn giữ quan hệ ban đầu.
			</div>{/if}
	</section>
</div>
<Modal
	bind:open={confirmOpen}
	title="Xem lại phương án điều phối"
	description="Phạm vi luôn bao gồm tất cả thành viên, kể cả thành viên cũ."
	wide
	>{#if plan}<div class="notice">
			<ShieldCheck size={20} />
			<p>
				Đầu mối: <strong>{appState.members.find((m) => m.id === plan!.hub)?.name}</strong>. Tạo {plan.entries
					.length} bút toán kế toán, không tạo khoản nợ cho chính mình.
			</p>
		</div>
		<h3>Các khoản nợ sau điều phối</h3>
		<div class="review-lines">
			{#each previewPositions as position}<div>
					<span
						><strong
							>{position.net < 0
								? position.member.name
								: appState.members.find((m) => m.id === plan!.hub)?.name} → {position.net < 0
								? appState.members.find((m) => m.id === plan!.hub)?.name
								: position.member.name}</strong
						><small>Số dư ròng của {position.member.name}: {currency(position.net)}</small></span
					><strong>{currency(Math.abs(position.net))}</strong>
				</div>{/each}
		</div>
		<p class="fine-print">
			Nếu có giao dịch mới hoặc yêu cầu QR đang hiệu lực, phương án sẽ bị từ chối để bạn kiểm tra lại.
		</p>
		<label class="checkbox-label"
			><input type="checkbox" bind:checked={acknowledged} />Tôi hiểu đây là điều phối sổ nợ, không phải thanh
			toán thực tế.</label
		>
		<div class="modal-actions">
			<Button variant="outline" onclick={() => (confirmOpen = false)}>Hủy</Button><Button
				disabled={!acknowledged || busy || !plan.entries.length}
				onclick={commit}>Xác nhận điều phối</Button
			>
		</div>{/if}</Modal
>
