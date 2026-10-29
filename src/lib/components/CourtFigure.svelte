<script lang="ts">
	import { Crown, Gem, Sprout, Feather } from '@lucide/svelte';
	import Avatar from './Avatar.svelte';
	import { currency } from '$lib/domain/ledger';
	import type { CourtRank } from '$lib/domain/leaderboard';
	let {
		entry,
		enthroned = false,
		compact = false,
		onselect
	}: {
		entry: CourtRank;
		enthroned?: boolean;
		compact?: boolean;
		onselect: (entry: CourtRank) => void;
	} = $props();
	const Emblem = $derived(
		entry.tier === 'sovereign'
			? Crown
			: entry.tier === 'noble'
				? Gem
				: entry.tier === 'commoner'
					? Sprout
					: Feather
	);
</script>

<button
	class="court-figure {entry.tier}"
	class:enthroned
	class:compact
	onclick={() => onselect(entry)}
	aria-label={`${entry.member.name}, ${entry.title}, hạng ${entry.rank}, Nợ - bị nợ: ${currency(0 - entry.credit)}`}
>
	<span class="figure-body" aria-hidden="true">
		<span class="figure-shadow"></span>
		<span class="figure-cape"></span>
		<span class="figure-robe"><span class="robe-chain"></span><span class="robe-jewel"></span></span>
		<span class="figure-portrait"><Avatar member={entry.member} size="large" /></span>
		<span class="figure-emblem"><Emblem size={enthroned ? 34 : 22} strokeWidth={1.6} /></span>
	</span>
	<span class="figure-caption">
		<small>{entry.title}</small>
		<strong title={entry.member.name}>{entry.member.name}</strong>
		{#if !compact}<span class="figure-amount">{currency(Math.abs(entry.credit))}</span>{/if}
	</span>
</button>

<style>
	.court-figure {
		--robe: #8155a4;
		--robe-dark: #321c50;
		--trim: #e1bd78;
		display: flex;
		flex-direction: column;
		align-items: center;
		width: 100%;
		padding: 0;
		border: 0;
		background: none;
		color: #fff0d5;
		cursor: pointer;
		-webkit-tap-highlight-color: transparent;
	}
	.sovereign {
		--robe: #a52b49;
		--robe-dark: #450e23;
		--trim: #ffdc8b;
	}
	.commoner {
		--robe: #498f84;
		--robe-dark: #183c3b;
		--trim: #b3d4c1;
	}
	.servant {
		--robe: #9d7153;
		--robe-dark: #423126;
		--trim: #d5b696;
	}
	.figure-body {
		position: relative;
		display: block;
		width: 90px;
		height: 112px;
		transition: transform 0.25s ease;
		filter: drop-shadow(0 8px 6px #0005);
	}
	.court-figure:hover .figure-body,
	.court-figure:focus-visible .figure-body {
		transform: translateY(-6px);
	}
	.court-figure:focus-visible {
		outline: 2px solid #f0ce88;
		outline-offset: 5px;
		border-radius: 8px;
	}
	.figure-shadow {
		position: absolute;
		bottom: -4px;
		left: 6px;
		width: 78px;
		height: 17px;
		border-radius: 50%;
		background: #0006;
		filter: blur(4px);
	}
	.figure-cape {
		position: absolute;
		left: 5px;
		right: 5px;
		top: 40px;
		bottom: 0;
		border-radius: 40% 40% 12% 12%;
		background: linear-gradient(100deg, var(--robe-dark), var(--robe) 45%, var(--robe-dark));
		clip-path: polygon(22% 0, 78% 0, 100% 100%, 0 100%);
	}
	.figure-robe {
		position: absolute;
		top: 47px;
		bottom: 0;
		left: 20px;
		right: 20px;
		border: 1px solid color-mix(in srgb, var(--trim), transparent 45%);
		border-radius: 45% 45% 8px 8px;
		background: linear-gradient(90deg, var(--robe-dark), var(--robe) 40%, var(--robe-dark));
		box-shadow:
			4px 2px 0 #0002,
			inset 0 -4px var(--trim);
	}
	.robe-chain {
		position: absolute;
		inset: 0 5px auto;
		height: 27px;
		border: 2px solid var(--trim);
		border-top: 0;
		border-radius: 0 0 50% 50%;
	}
	.robe-jewel {
		position: absolute;
		top: 27px;
		left: calc(50% - 3px);
		width: 6px;
		height: 9px;
		background: var(--trim);
		transform: rotate(45deg);
		box-shadow: 0 0 9px #f8d59166;
	}
	.figure-portrait {
		position: absolute;
		left: 19px;
		top: 6px;
		width: 52px;
		height: 52px;
		border: 2px solid var(--trim);
		border-radius: 50%;
		background: #e8dcc6;
		box-shadow:
			0 3px 0 #0004,
			0 0 18px #efc37918;
		overflow: hidden;
	}
	.figure-portrait :global(.avatar) {
		width: 100%;
		height: 100%;
		font-size: 18px;
	}
	.figure-emblem {
		position: absolute;
		left: 50%;
		top: -13px;
		transform: translateX(-50%) rotate(-7deg);
		color: var(--trim);
		filter: drop-shadow(0 2px 2px #0008);
	}
	.sovereign .figure-emblem :global(svg) {
		fill: #d9a340;
		stroke: #ffe7ac;
	}
	.figure-caption {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 3px;
		width: 100%;
		margin-top: 10px;
		text-shadow: 0 2px 5px #120d19;
	}
	.figure-caption small {
		color: var(--trim);
		font-size: 10px;
		letter-spacing: 0.04em;
	}
	.figure-caption strong {
		max-width: 100%;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		font-size: 12px;
		font-weight: 600;
	}
	.figure-amount {
		max-width: 100%;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		color: #f5d69d;
		font-size: 11px;
		font-variant-numeric: tabular-nums;
	}
	.enthroned .figure-body {
		transform: scale(1.15);
		transform-origin: bottom center;
	}
	.enthroned:hover .figure-body,
	.enthroned:focus-visible .figure-body {
		transform: scale(1.15) translateY(-5px);
	}
	.enthroned .figure-caption strong {
		font-size: 15px;
	}
	.enthroned .figure-caption small {
		text-transform: uppercase;
		letter-spacing: 0.12em;
	}
	.enthroned .figure-amount {
		font-size: 13px;
	}
	.enthroned .figure-emblem {
		top: -24px;
	}
	.compact .figure-body {
		transform: scale(0.7);
		height: 82px;
		transform-origin: bottom center;
	}
	.compact:hover .figure-body,
	.compact:focus-visible .figure-body {
		transform: scale(0.7) translateY(-6px);
	}
	.compact .figure-caption {
		margin-top: 6px;
	}
	.compact .figure-caption strong {
		font-size: 10px;
	}
	.compact .figure-caption small {
		font-size: 9px;
	}
	@media (min-width: 600px) {
		.figure-caption strong {
			font-size: 14px;
		}
		.figure-caption small,
		.figure-amount {
			font-size: 12px;
		}
		.compact .figure-caption strong {
			font-size: 12px;
		}
		.compact .figure-caption small {
			font-size: 10px;
		}
	}
	@media (prefers-reduced-motion: reduce) {
		.figure-body {
			transition: none;
		}
	}
</style>
