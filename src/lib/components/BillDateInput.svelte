<script lang="ts">
	import { CalendarDays } from '@lucide/svelte';
	import { billDateLabel } from '$lib/domain/ledger';
	let { value = $bindable(''), invalid = false }: { value: string; invalid?: boolean } = $props();
	const display = $derived(
		value && !Number.isNaN(new Date(value).getTime()) ? billDateLabel(value) : 'Chọn ngày'
	);
	function openPicker(event: MouseEvent) {
		try {
			(event.currentTarget as HTMLInputElement).showPicker();
		} catch {
			/* Keep native keyboard editing available. */
		}
	}
</script>

<div class="bill-date-control" aria-invalid={invalid}>
	<span class="bill-date-label" aria-hidden="true">{display}</span>
	<CalendarDays size={17} aria-hidden="true" />
	<input
		class="bill-date-native"
		type="date"
		aria-label="Ngày thanh toán"
		aria-invalid={invalid}
		bind:value
		onclick={openPicker}
	/>
</div>
