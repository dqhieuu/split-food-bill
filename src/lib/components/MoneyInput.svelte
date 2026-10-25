<script lang="ts">
	import { Input } from '$lib/components/ui/input';
	let {
		value = $bindable(),
		unit,
		invalid = false,
		placeholder = '0',
		label
	}: {
		value: number | undefined | null;
		unit: number;
		invalid?: boolean;
		placeholder?: string;
		label: string;
	} = $props();
	const hasValue = $derived(value !== undefined && value !== null && String(value) !== '');
</script>

<div class="money-input">
	<Input
		type="number"
		inputmode="decimal"
		min="0"
		step={unit === 1000 ? '0.001' : '1'}
		aria-label={label}
		aria-invalid={invalid}
		{placeholder}
		bind:value
	/>
	<span class="money-suffix" aria-hidden="true"
		><span class="money-mirror">{hasValue ? value : placeholder}</span><span
			>{' ' + (unit === 1000 ? 'nghìn đồng' : 'đồng')}</span
		></span
	>
</div>
