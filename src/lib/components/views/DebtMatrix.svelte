<script lang="ts">
	import { Scale, ShieldCheck, Clock } from '@lucide/svelte';
	import { Button } from '$lib/components/ui/button';
	import Modal from '../Modal.svelte';
	import Avatar from '../Avatar.svelte';
	import type { AppState, SettlementPlan } from '$lib/domain/types';
	import type { RunCommand } from '$lib/client/types';
	import { currency, pairBalance, netBalance, settlementPlan, dateTimeLabel } from '$lib/domain/ledger';
	let { appState, actor, run, busy }: { appState: AppState; actor: string; run: RunCommand; busy: boolean } =
		$props();
	let confirmOpen = $state(false);
	let plan = $state<SettlementPlan | null>(null);
	let planError = $state('');
	const members = $derived(appState.members.filter((m) => m.active));
	const isAdmin = $derived(appState.members.find((m) => m.id === actor)?.role === 'admin');
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
					'Đã tối giản nợ; nợ - bị nợ của từng người được giữ nguyên.'
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
{#if planError}<p class="notice warm" role="alert"><Clock size={18} />{planError}</p>{/if}
<section class="panel matrix-panel">
	<div class="table-scroll">
		<table class="matrix-table">
			<thead>
				<tr>
					<th class="matrix-corner" aria-label="Hàng: Con nợ. Cột: Chủ nợ.">
						<span class="matrix-column-label">Chủ nợ</span>
						<span class="matrix-row-label">Con nợ</span>
					</th>
					{#each members as member}
						<th scope="col" title={member.name} aria-label={member.name}>
							<div class="matrix-member-heading">
								<Avatar {member} size="small" />
								<span class="matrix-member-name">{member.name.split(' ').slice(-1)[0]}</span>
							</div>
						</th>
					{/each}
				</tr>
				<tr class="matrix-net-row">
					<th scope="row">Nợ - bị nợ</th>
					{#each members as member}
						{@const net = 0 - netBalance(appState.ledger, member.id)}
						<th scope="col" aria-label={`${member.name}, Nợ - bị nợ: ${currency(net)}`}>
							<strong class="matrix-net" class:net-owing={net > 0} class:net-owed={net < 0}
								>{currency(net)}</strong
							>
						</th>
					{/each}
				</tr>
			</thead>
			<tbody
				>{#each members as row}<tr
						><th><span>{row.name}</span></th>{#each members as column}{@const balance = pairBalance(
								appState.ledger,
								row.id,
								column.id
							)}<td
								class:self-cell={row.id === column.id}
								class:debt-cell={balance > 0}
								class:credit-cell={balance < 0}
								title={`${row.name} → ${column.name}: ${currency(balance)}`}
								>{row.id === column.id ? '—' : currency(balance)}</td
							>{/each}</tr
					>{/each}</tbody
			>
		</table>
	</div>
</section>
{#if isAdmin}<Button class="simplify-button" onclick={preview} disabled={busy}
		><Scale size={20} /> Tối giản nợ</Button
	>{/if}
<div class="two-panels">
	<section class="panel info-panel">
		<div class="simplification-heading">
			<span class="feature-icon"><Scale size={22} /></span>
			<h2>Cách tối giản hoạt động</h2>
		</div>
		<ol class="simplification-steps">
			<li>Bước 1: Cân bằng nợ nần về 0</li>
			<li>Bước 2: Người nợ trả tiền cho nợ chúa</li>
			<li>Bước 3: Nợ chúa trả tiền cho người bị nợ</li>
		</ol>
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
				<span class="stat-icon"><Scale size={17} /></span>
				<div>
					<strong>Nợ chúa: {appState.members.find((m) => m.id === batch.hub)?.name}</strong><small
						>{dateTimeLabel(batch.date)} · {batch.entryCount} bản ghi được thêm vào Ledger</small
					>
				</div>
			</div>{/each}{#if !appState.settlements.length}<div class="inline-empty">
				Chưa có lần tối giản nào.
			</div>{/if}
	</section>
</div>
<Modal bind:open={confirmOpen} title="Xem lại phương án tối giản nợ" wide compact
	>{#if plan}<div class="notice">
			<ShieldCheck size={20} />
			<p>
				Nợ chúa: <strong>{hubName}</strong>. Sau khi tối giản, {plan.entries.length} bản ghi sẽ được thêm vào Ledger.
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
						><small>Nợ - bị nợ của {position.member.name}: {currency(-position.net)}</small></span
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
