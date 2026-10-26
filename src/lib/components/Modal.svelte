<script lang="ts">
	import * as Dialog from '$lib/components/ui/dialog';
	import type { Snippet } from 'svelte';
	let {
		open = $bindable(false),
		title,
		description = '',
		children,
		wide = false,
		compact = false
	}: {
		open: boolean;
		title: string;
		description?: string;
		children: Snippet;
		wide?: boolean;
		compact?: boolean;
	} = $props();
</script>

<Dialog.Root bind:open>
	<Dialog.Content class={`${wide ? 'app-modal wide-modal' : 'app-modal'}${compact ? ' compact-modal' : ''}`}>
		<Dialog.Header
			><Dialog.Title>{title}</Dialog.Title>{#if description}<Dialog.Description
					>{description}</Dialog.Description
				>{/if}</Dialog.Header
		>
		{@render children()}
	</Dialog.Content>
</Dialog.Root>
