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
	let inputText = $state('');
	const amountPattern = /^\d*(?:[.,]\d*)?$/;
	const parseAmount = (text: string) =>
		text === '' || text === '.' || text === ',' ? null : Number(text.replace(',', '.'));
	$effect(() => {
		if ((value ?? null) !== parseAmount(inputText))
			inputText = value == null ? '' : String(Math.max(0, value));
	});
	function updateAmount(event: Event) {
		const input = event.currentTarget as HTMLInputElement;
		const next = input.value;
		if (!amountPattern.test(next) || (parseAmount(next) !== null && !Number.isFinite(parseAmount(next)))) {
			input.value = inputText;
			return;
		}
		inputText = next;
		value = parseAmount(next);
	}
	function preventInvalidInput(event: InputEvent) {
		if (event.data && /[eE+\-]/.test(event.data)) event.preventDefault();
	}
	function validatePaste(event: ClipboardEvent) {
		if (!amountPattern.test(event.clipboardData?.getData('text') ?? '')) event.preventDefault();
	}
</script>

<div class="money-input">
	<Input
		type="text"
		inputmode="decimal"
		autocomplete="off"
		pattern="[0-9]*[.,]?[0-9]*"
		aria-label={label}
		aria-invalid={invalid}
		{placeholder}
		value={inputText}
		oninput={updateAmount}
		onbeforeinput={preventInvalidInput}
		onpaste={validatePaste}
	/>
	<span class="money-suffix" aria-hidden="true"
		><span class="money-mirror">{inputText || placeholder}</span><span
			>{' ' + (unit === 1000 ? 'nghìn đồng' : 'đồng')}</span
		></span
	>
</div>
