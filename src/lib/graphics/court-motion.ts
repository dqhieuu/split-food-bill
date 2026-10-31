const smooth = (value: number) => {
	const t = Math.max(0, Math.min(1, value));
	return t * t * (3 - 2 * t);
};

// One clock for every figure and rope, independent of each character's idle phase.
export function courtTug(seconds: number) {
	const t = (((seconds % 5) + 5) % 5) - 2;
	const pull = smooth(t / 0.35) * (1 - smooth((t - 0.65) / 0.7));
	const delayed = t - 0.16;
	const reaction =
		delayed > 0 && delayed < 1.6 ? Math.sin(delayed * 16) * Math.exp(-delayed * 3.8) * 1.35 : 0;
	return { pull, reaction };
}
