<script lang="ts">
	import type { ComponentProps } from 'svelte';
	import Balances from './Balances.svelte';
	import {
		settlementFixture,
		settlementScenarios,
		type SettlementScenario
	} from '$lib/client/settlement-fixtures';

	let props: Omit<ComponentProps<typeof Balances>, 'onSimulateMember'> = $props();
	let scenario = $state<SettlementScenario | ''>('');
	let member = $state('');
	const sample = $derived(scenario ? settlementFixture(scenario) : null);
	const simulatedActor = $derived(member || (scenario ? settlementScenarios[scenario].member : ''));
	const blockCommand = async () => {
		throw new Error('Không thể ghi dữ liệu khi đang mô phỏng.');
	};
</script>

<section class="panel settlement-debug" aria-label="Mô phỏng tối giản nợ">
	<label class="balance-account-picker">
		<span>Mô phỏng tối giản nợ</span>
		<select bind:value={scenario} onchange={() => (member = '')}>
			<option value="">Dữ liệu thật</option>
			{#each Object.entries(settlementScenarios) as [id, { label }]}
				<option value={id}>{label}</option>
			{/each}
		</select>
	</label>
	<p>Chọn tình huống để xem số dư và hóa đơn mẫu. Dữ liệu của nhóm không thay đổi.</p>
</section>

{#key scenario}
	{#if sample}
		<Balances
			appState={sample}
			actor={simulatedActor}
			run={blockCommand}
			busy={false}
			groupId=""
			onSimulateMember={(id) => (member = id)}
		/>
	{:else}
		<Balances {...props} />
	{/if}
{/key}

<style>
	.settlement-debug {
		display: flex;
		flex-wrap: wrap;
		align-items: end;
		gap: 8px 16px;
		padding: 12px 16px;
		margin-bottom: 16px;
	}
	.settlement-debug p {
		font-size: 13px;
	}
</style>
