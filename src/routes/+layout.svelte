<script lang="ts">
	import '../app.css';
	let { children } = $props();
</script>

<div data-sveltekit-replacestate>
	{@render children()}
</div>
