/** Reserves a narrow left-edge gesture for opening the phone sidebar. */
export function sidebarSwipe(node: HTMLElement, open: () => void) {
	const mobile = matchMedia('(max-width: 760px)');
	let start: { id: number; x: number; y: number; time: number } | undefined;
	function reset() {
		start = undefined;
	}
	function touchStart(event: TouchEvent) {
		reset();
		if (!mobile.matches || event.touches.length !== 1) return;
		const touch = event.touches[0];
		if (touch.clientX > 24) return;
		const target = event.target;
		if (!(target instanceof Element)) return;
		if (target.closest('button, a, input, select, textarea, [contenteditable], [role="slider"]')) return;
		if (document.querySelector('[role="dialog"], [role="menu"]')) return;
		// Horizontal table scrolling must keep its own gesture, even at the edge.
		for (let element: Element | null = target; element && element !== node; element = element.parentElement) {
			if (
				element.scrollWidth > element.clientWidth + 1 &&
				/auto|scroll/.test(getComputedStyle(element).overflowX)
			)
				return;
		}
		start = { id: touch.identifier, x: touch.clientX, y: touch.clientY, time: event.timeStamp };
		// Safari's browser-back gesture must yield to this app gesture at the left edge.
		if (event.cancelable) event.preventDefault();
	}
	function touchMove(event: TouchEvent) {
		if (!start) return;
		const touch = Array.from(event.touches).find((touch) => touch.identifier === start!.id);
		if (
			event.touches.length !== 1 ||
			!touch ||
			Math.abs(touch.clientY - start.y) > 40 ||
			touch.clientX < start.x - 12
		)
			reset();
	}
	function touchEnd(event: TouchEvent) {
		const began = start;
		reset();
		if (!began || !mobile.matches || event.touches.length) return;
		const touch = Array.from(event.changedTouches).find((touch) => touch.identifier === began.id);
		if (!touch) return;
		const dx = touch.clientX - began.x,
			dy = Math.abs(touch.clientY - began.y);
		if (dx < 70 || dy > 40 || dx < dy * 2 || event.timeStamp - began.time > 800) return;
		if (event.cancelable) event.preventDefault();
		open();
	}
	node.addEventListener('touchstart', touchStart, { passive: false });
	node.addEventListener('touchmove', touchMove, { passive: true });
	node.addEventListener('touchend', touchEnd, { passive: false });
	node.addEventListener('touchcancel', reset, { passive: true });
	return {
		destroy() {
			node.removeEventListener('touchstart', touchStart);
			node.removeEventListener('touchmove', touchMove);
			node.removeEventListener('touchend', touchEnd);
			node.removeEventListener('touchcancel', reset);
		}
	};
}
