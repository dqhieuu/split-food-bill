import { DragGesture } from '@use-gesture/vanilla';

/** Recognize edge drags without imposing a speed limit or a strict vertical cutoff. */
export function sidebarSwipe(node: HTMLElement, open: () => void) {
	const mobile = matchMedia('(max-width: 760px)');
	let eligible = false;
	function touchStart(event: TouchEvent) {
		eligible = false;
		if (!mobile.matches || event.touches.length !== 1 || event.touches[0].clientX > 40) return;
		const target = event.target;
		if (!(target instanceof Element)) return;
		if (target.closest('input, select, textarea, [contenteditable], [role="slider"]')) return;
		if (document.querySelector('[role="dialog"], [role="menu"]')) return;
		for (let element: Element | null = target; element && element !== node; element = element.parentElement) {
			if (
				element.scrollWidth > element.clientWidth + 1 &&
				/auto|scroll/.test(getComputedStyle(element).overflowX)
			)
				return;
		}
		eligible = true;
		// Reserve the edge for the drawer instead of Safari's browser-back gesture.
		if (event.cancelable) event.preventDefault();
	}
	function touchMove(event: TouchEvent) {
		if (event.touches.length !== 1) eligible = false;
	}
	function reset() {
		eligible = false;
	}
	node.addEventListener('touchstart', touchStart, { passive: false, capture: true });
	node.addEventListener('touchmove', touchMove, { passive: true, capture: true });
	node.addEventListener('touchcancel', reset, { passive: true, capture: true });
	const config = {
		axis: 'x' as const,
		threshold: 12,
		filterTaps: true,
		pointer: { touch: true, keys: false },
		eventOptions: { passive: false }
	};
	const drag = new DragGesture(
		node,
		({ active, intentional, values, initial }) => {
			if (!eligible || !active || !intentional || !mobile.matches) return;
			if (values[0] - initial[0] < 45) return;
			eligible = false;
			open();
		},
		{ ...config, enabled: mobile.matches }
	);
	const resize = () => drag.setConfig({ ...config, enabled: mobile.matches });
	mobile.addEventListener('change', resize);
	return {
		destroy() {
			drag.destroy();
			mobile.removeEventListener('change', resize);
			node.removeEventListener('touchstart', touchStart, true);
			node.removeEventListener('touchmove', touchMove, true);
			node.removeEventListener('touchcancel', reset, true);
		}
	};
}
