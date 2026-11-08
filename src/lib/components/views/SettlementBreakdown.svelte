<script lang="ts">
	import { ChevronDown, ChevronLeft, ChevronRight } from '@lucide/svelte';
	import { DropdownMenu } from 'bits-ui';
	import { untrack } from 'svelte';
	import { Badge } from '$lib/components/ui/badge';
	import { currency, dateTimeLabel } from '$lib/domain/ledger';
	import {
		settlementBreakdown,
		type CashFlowPart,
		type CashFlowRoute
	} from '$lib/domain/settlement-breakdown';
	import type { AppState, SettlementFlowPreference, SettlementFlowUpdate } from '$lib/domain/types';

	let {
		appState,
		accountId,
		subject,
		preference,
		onPreferenceChange,
		simulation = false,
		onBillClick
	}: {
		appState: AppState;
		accountId: string;
		subject: string;
		preference?: SettlementFlowPreference;
		onPreferenceChange?: (change: SettlementFlowUpdate) => void;
		simulation?: boolean;
		onBillClick: (id: string) => void;
	} = $props();
	const flow = $derived(appState.settlements.length ? settlementBreakdown(appState, accountId) : null);
	let selectedId = $state('');
	const selectedIndex = $derived(
		Math.max(0, flow?.history.findIndex(({ batch }) => batch.id === selectedId) ?? -1)
	);
	const selected = $derived(flow?.history[selectedIndex]);
	let expandedOverride = $state<boolean | undefined>();
	const expanded = $derived(expandedOverride ?? preference?.expanded ?? simulation);
	let visible = $state<DocumentVisibilityState>();
	let firstViewId = $state('');
	let latestId = '';
	const unread = $derived.by(() => {
		const baseline = preference?.baselineVersion;
		const seen = new Set(preference?.seenBatchIds);
		return new Set(
			flow?.history
				.filter(({ batch }) => baseline !== undefined && batch.version >= baseline && !seen.has(batch.id))
				.map(({ batch }) => batch.id)
		);
	});
	$effect(() => {
		if (onPreferenceChange && preference?.baselineVersion === undefined) {
			const baselineVersion = appState.version;
			untrack(() => onPreferenceChange?.({ baselineVersion }));
		}
	});
	$effect(() => {
		const newest = flow?.history[0]?.batch.id ?? '';
		if (newest !== latestId) {
			latestId = newest;
			if (unread.has(newest)) {
				selectedId = '';
				expandedOverride = true;
			}
		}
	});
	$effect(() => {
		const id = expanded && visible === 'visible' ? selected?.batch.id : undefined;
		if (id === firstViewId) return;
		if (id && unread.has(id)) {
			firstViewId = id;
			untrack(() => onPreferenceChange?.({ seenBatchId: id }));
		} else {
			firstViewId = '';
		}
	});
	const midSubject = $derived(subject === 'Bạn' ? 'bạn' : subject);
	const people = $derived(new Map(appState.members.map((member) => [member.id, member.name])));
	const bills = $derived(new Map(appState.bills.map((bill) => [bill.id, bill])));
	const name = (id: string) => people.get(id) ?? id;
	const list = new Intl.ListFormat('vi');
	const signed = (amount: number) => `${amount < 0 ? '−' : '+'}${currency(Math.abs(amount))}`;
	const payees = (routes: CashFlowRoute[]) =>
		routes.filter((route) => route.from === accountId).map((route) => name(route.to));
	const payers = (routes: CashFlowRoute[]) =>
		routes.filter((route) => route.to === accountId).map((route) => name(route.from));
	function toggleExpanded() {
		const next = !expanded;
		expandedOverride = next;
		onPreferenceChange?.({ expanded: next });
	}

	function selectBatch(id: string) {
		// Follow the latest batch on refresh until the user selects an older one.
		selectedId = id === flow?.history[0]?.batch.id ? '' : id;
	}

	function moveBatch(offset: number) {
		const next = flow?.history[selectedIndex + offset];
		if (next) selectBatch(next.batch.id);
	}

	function routeTotals(routes: CashFlowRoute[]) {
		let toPay = 0;
		let toReceive = 0;
		for (const route of routes) {
			if (route.from === accountId) toPay += route.amount;
			else toReceive += route.amount;
		}
		return { toPay, toReceive };
	}

	function partLabel(part: CashFlowPart) {
		const { entry } = part;
		if (entry.source === 'settlement' || entry.source === 'reversal')
			return 'Khoản chưa xác định được hóa đơn';
		if (entry.type === 'payment') return `Đã chuyển tiền · ${name(entry.from)} → ${name(entry.to)}`;
		return entry.description || 'Khoản nợ';
	}
</script>

<svelte:document bind:visibilityState={visible} />

{#snippet billLabel(billId: string | undefined, fallback: string)}
	{@const bill = billId ? bills.get(billId) : undefined}
	{#if bill}
		<button type="button" class="flow-bill" aria-haspopup="dialog" onclick={() => onBillClick(bill.id)}>
			{bill.description || 'Xem hóa đơn'}
		</button>
	{:else}
		<strong>{fallback}</strong>
	{/if}
{/snippet}

{#snippet routeList(routes: CashFlowRoute[])}
	{#each routes as route}
		{@const outgoing = route.from === accountId}
		{@const refund = route.parts.every(
			({ entry, amount }) =>
				entry.type === 'payment' &&
				entry.source !== 'settlement' &&
				entry.from === route.to &&
				entry.to === route.from &&
				amount > 0
		)}
		<section class="flow-route">
			<h4 class:loss-amount={outgoing} class:gain-amount={!outgoing}>
				{outgoing
					? `Cần trả cho ${name(route.to)}`
					: `${refund ? 'Nhận lại từ' : 'Sẽ nhận từ'} ${name(route.from)}`} ·
				{currency(route.amount)}
			</h4>
			{#each route.parts as part (part.entry.id)}
				{@const payment =
					part.entry.type === 'payment' &&
					part.entry.source !== 'settlement' &&
					part.entry.source !== 'reversal'}
				{@const billAlreadyListed =
					payment && route.parts.some((item) => item.billId === part.billId && item.entry.type === 'debt')}
				{@const linkedBillId = billAlreadyListed ? undefined : part.billId}
				<div
					class="counterpart-history-entry"
					class:flow-bill-entry={!!linkedBillId && bills.has(linkedBillId)}
				>
					<div class="counterpart-history-info">
						{@render billLabel(linkedBillId, partLabel(part))}
						{#if payment}
							{#if !billAlreadyListed && part.billId && bills.has(part.billId)}<small>{partLabel(part)}</small
								>{/if}
							{#if !part.billId}<small>Hoá đơn gốc không xác định</small>{/if}
						{:else if part.billId}
							<small>Phần của {name(part.entry.from)} · Người thanh toán {name(part.entry.to)}</small>
						{/if}
					</div>
					<span class="counterpart-history-amount"
						>{part.amount < 0 ? '−' : ''}{currency(Math.abs(part.amount))}</span
					>
				</div>
			{/each}
		</section>
	{:else}
		<p>Không có khoản nào cần trả hoặc chờ nhận.</p>
	{/each}
{/snippet}

{#snippet snapshot(title: string, routes: CashFlowRoute[])}
	{@const { toPay, toReceive } = routeTotals(routes)}
	<section aria-label={title}>
		<h3 class="flow-snapshot-heading">
			{title}
			<span class="flow-totals">
				{#if toReceive}<span class="gain-amount">Nhận {currency(toReceive)}</span>{/if}
				{#if toPay}<span class="loss-amount">Trả {currency(toPay)}</span>{/if}
				{#if !toReceive && !toPay}<span>{currency(0)}</span>{/if}
			</span>
		</h3>
		{@render routeList(routes)}
	</section>
{/snippet}

{#if flow && selected}
	{@const { batch, before, after } = selected}
	{@const showNew = simulation || firstViewId === batch.id}
	{@const beforePayees = payees(before)}
	{@const beforePayers = payers(before)}
	{@const afterPayees = payees(after)}
	{@const afterPayers = payers(after)}
	<section
		class="panel cash-flow"
		class:flow-undone={!!batch.undoneAt}
		aria-label="Dòng tiền sau tối giản nợ"
	>
		<header class="flow-header" class:expanded>
			<h2>
				<button
					type="button"
					class="flow-toggle"
					aria-expanded={expanded}
					aria-controls="settlement-flow-content"
					onclick={toggleExpanded}
				>
					Dòng tiền sau tối giản nợ
					<span class="collapse-chevron" class:expanded aria-hidden="true"><ChevronDown size={18} /></span>
				</button>
			</h2>
			{#if expanded}
				<div class="cal-month flow-picker" role="group" aria-label="Chọn lần tối giản nợ">
					<button
						type="button"
						class="icon-button"
						aria-label="Lần tối giản trước"
						disabled={selectedIndex === flow.history.length - 1}
						onclick={() => moveBatch(1)}><ChevronLeft size={16} /></button
					>
					<DropdownMenu.Root>
						<DropdownMenu.Trigger
							class="flow-date"
							aria-label={`Ngày tối giản: ${dateTimeLabel(batch.date)}${showNew ? ', mới' : ''}${batch.undoneAt ? ', đã hoàn tác' : ''}`}
						>
							{#if showNew}<Badge class="leading-none">Mới</Badge>{/if}
							<span aria-live="polite" class:line-through={!!batch.undoneAt}>{dateTimeLabel(batch.date)}</span
							><ChevronDown size={14} />
						</DropdownMenu.Trigger>
						<DropdownMenu.Portal>
							<DropdownMenu.Content
								class="z-100 max-h-72 max-w-[calc(100vw-24px)] overflow-y-auto rounded-lg border bg-background p-1.5 text-foreground shadow-lg"
								sideOffset={8}
								collisionPadding={12}
							>
								<DropdownMenu.RadioGroup value={batch.id} onValueChange={selectBatch}>
									{#each flow.history as { batch: option } (option.id)}
										<DropdownMenu.RadioItem
											class="flex cursor-pointer items-center gap-2 rounded-md px-3 py-2 text-sm outline-none data-highlighted:bg-muted data-[state=checked]:font-semibold"
											value={option.id}
										>
											<span>
												{dateTimeLabel(option.date)} · Nợ chúa {name(option.hub)}{option.undoneAt
													? ' · Đã hoàn tác'
													: ''}
											</span>
											{#if simulation || unread.has(option.id) || firstViewId === option.id}
												<Badge class="leading-none">Mới</Badge>
											{/if}
										</DropdownMenu.RadioItem>
									{/each}
								</DropdownMenu.RadioGroup>
							</DropdownMenu.Content>
						</DropdownMenu.Portal>
					</DropdownMenu.Root>
					<button
						type="button"
						class="icon-button"
						aria-label="Lần tối giản sau"
						disabled={selectedIndex === 0}
						onclick={() => moveBatch(-1)}><ChevronRight size={16} /></button
					>
				</div>
			{/if}
		</header>
		<div id="settlement-flow-content" class="flow-content" hidden={!expanded}>
			{#if expanded}
				{#if batch.undoneAt}
					<p>Lần tối giản nợ này đã được hoàn tác.</p>
				{:else}
					<p>
						{#if before.length}
							<span class="flow-previous">
								{#if beforePayees.length && beforePayers.length}
									{subject} từng phải trả tiền cho <strong>{list.format(beforePayees)}</strong> và chờ nhận
									tiền từ <strong>{list.format(beforePayers)}</strong>.
								{:else if beforePayees.length}
									{subject} từng phải trả tiền cho <strong>{list.format(beforePayees)}</strong>.
								{:else}
									{subject} từng chờ nhận tiền từ <strong>{list.format(beforePayers)}</strong>.
								{/if}
							</span>
							<br />
						{/if}
						{'→ '}
						{#if !after.length}
							Sau khi tối giản nợ, {midSubject} không còn khoản nào cần trả hoặc sẽ nhận.
						{:else if batch.hub === accountId}
							Sau khi tối giản nợ, {midSubject} trở thành <strong>nợ chúa</strong>.
							{#if afterPayers.length && afterPayees.length}
								{subject} sẽ nhận tiền từ <strong>{list.format(afterPayers)}</strong> và phải chuyển tiền cho
								<strong>{list.format(afterPayees)}</strong>.
							{:else if afterPayers.length}
								{subject} sẽ nhận tiền từ <strong>{list.format(afterPayers)}</strong>.
							{:else if afterPayees.length}
								{subject} phải chuyển tiền cho <strong>{list.format(afterPayees)}</strong>.
							{/if}
						{:else if afterPayees.length}
							Sau khi tối giản nợ, {midSubject} chỉ cần trả tiền cho nợ chúa
							<strong>{name(batch.hub)}</strong>.
						{:else}
							Sau khi tối giản nợ, {midSubject} chỉ cần chờ nhận tiền từ nợ chúa
							<strong>{name(batch.hub)}</strong>.
						{/if}
					</p>
				{/if}
				<div class="flow-comparison">
					{@render snapshot('Trước tối giản', before)}
					{@render snapshot('Sau tối giản', after)}
				</div>
				{#if flow.transfers.length}
					<details>
						<summary>Lịch sử chuyển tiền</summary>
						{#each flow.transfers as { entry, billMatches } (entry.id)}
							{@const billIds = billMatches?.billIds.filter((id) => bills.has(id)) ?? []}
							<div class="counterpart-history-entry">
								<div class="counterpart-history-info">
									<strong
										>{entry.from === accountId
											? `Đã trả ${name(entry.to)}`
											: `Đã nhận từ ${name(entry.from)}`}</strong
									>
									<small>{dateTimeLabel(entry.date)}</small>
									{#if billIds.length}
										{#if billMatches?.uncertain}
											<small>Hóa đơn có thể liên quan</small>
										{:else if billIds.length > 1}
											<small>Hóa đơn liên quan</small>
										{/if}
										<div class="flow-transfer-bills">
											{#each billIds as billId (billId)}
												{@render billLabel(billId, '')}
											{/each}
										</div>
									{/if}
								</div>
								<span class="counterpart-history-amount"
									>{signed(entry.from === accountId ? -entry.amount : entry.amount)}</span
								>
							</div>
						{/each}
					</details>
				{/if}
			{/if}
		</div>
	</section>
{/if}

<style>
	.cash-flow {
		margin-bottom: 16px;
	}
	.cash-flow.flow-undone {
		background: light-dark(#f0f0f0, #242424);
	}
	.flow-header {
		position: relative;
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		justify-content: space-between;
		gap: 8px 12px;
		padding: 16px;
	}
	.flow-header.expanded {
		padding-bottom: 0;
	}
	.flow-toggle {
		display: flex;
		align-items: center;
		gap: 8px;
		text-align: left;
		cursor: pointer;
	}
	.flow-toggle::before {
		content: '';
		position: absolute;
		inset: 0;
	}
	.flow-picker {
		position: relative;
		z-index: 1;
		--cal-line: var(--border);
		--cal-cell: var(--background);
	}
	.flow-picker :global(.flow-date) {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		gap: 4px;
		border-radius: 6px;
		padding: 2px 4px;
		line-height: 1.25;
	}
	.flow-picker :global(.flow-date:hover) {
		background: var(--muted);
	}
	.flow-content {
		padding: 0 16px 16px;
	}
	.flow-content > p {
		margin-top: 6px;
		font-size: 14px;
	}
	.flow-previous {
		color: light-dark(#6e7865, #a3ab9c);
	}
	.flow-snapshot-heading,
	.flow-totals {
		display: flex;
		flex-wrap: wrap;
		align-items: baseline;
		gap: 2px 10px;
	}
	.flow-totals {
		font-size: 13px;
		font-variant-numeric: tabular-nums;
	}
	.flow-totals > span {
		white-space: nowrap;
	}
	@media (width > 760px) {
		.flow-comparison {
			display: grid;
			grid-template-columns: repeat(2, minmax(0, 1fr));
			column-gap: 24px;
		}
	}
	.cash-flow h3,
	.cash-flow details {
		margin-top: 12px;
	}
	.cash-flow summary {
		cursor: pointer;
		font-weight: 600;
	}
	.flow-route {
		margin-top: 10px;
	}
	.flow-route > .counterpart-history-entry {
		margin-inline: 12px;
	}
	.flow-route h4 {
		font-weight: 650;
	}
	.flow-transfer-bills {
		display: grid;
	}
	.flow-transfer-bills .flow-bill {
		padding-block: 2px;
	}
	.flow-bill-entry {
		position: relative;
	}
	.flow-bill-entry .flow-bill::before {
		content: '';
		position: absolute;
		inset: 0;
	}
	.flow-bill {
		font-size: 14px;
		text-align: left;
		font-weight: 600;
		overflow-wrap: anywhere;
	}
</style>
