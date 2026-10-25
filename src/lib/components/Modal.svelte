<script lang="ts">
	import * as Dialog from '$lib/components/ui/dialog';
	import type { Snippet } from 'svelte';
	let {
		open = $bindable(false),
		title,
		description = '',
		children,
		wide = false
	}: { open: boolean; title: string; description?: string; children: Snippet; wide?: boolean } = $props();
</script>

<Dialog.Root bind:open>
	<Dialog.Content class={wide ? 'app-modal wide-modal' : 'app-modal'}>
		<Dialog.Header
			><Dialog.Title>{title}</Dialog.Title><Dialog.Description>{description}</Dialog.Description
			></Dialog.Header
		>
		{@render children()}
	</Dialog.Content>
</Dialog.Root>
