<script lang="ts">
	import { onMount } from 'svelte';
	import '../app.css';
	let { children } = $props();
	onMount(() => {
		const mobile = matchMedia('(max-width: 760px)');
		const preventGestureZoom = (event: Event) => {
			if (mobile.matches) event.preventDefault();
		};
		const preventPinchZoom = (event: TouchEvent) => {
			if (mobile.matches && event.touches.length > 1) event.preventDefault();
		};
		// Safari can ignore viewport scaling limits; retain single-finger page/table scrolling.
		document.addEventListener('gesturestart', preventGestureZoom, { passive: false });
		document.addEventListener('gesturechange', preventGestureZoom, { passive: false });
		document.addEventListener('touchstart', preventPinchZoom, { passive: false });
		document.addEventListener('touchmove', preventPinchZoom, { passive: false });
		return () => {
			document.removeEventListener('gesturestart', preventGestureZoom);
			document.removeEventListener('gesturechange', preventGestureZoom);
			document.removeEventListener('touchstart', preventPinchZoom);
			document.removeEventListener('touchmove', preventPinchZoom);
		};
	});
</script>

<div data-sveltekit-replacestate>
	{@render children()}
</div>
