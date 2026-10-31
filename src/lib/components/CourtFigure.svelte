<script lang="ts">
	import Avatar from './Avatar.svelte';
	import { currency } from '$lib/domain/ledger';
	import type { CourtRank } from '$lib/domain/leaderboard';
	import type { CourtAppearance } from '$lib/graphics/court-model';
	let {
		entry,
		enthroned = false,
		compact = false,
		kneeling: kneelingPose = false,
		onselect
	}: {
		entry: CourtRank;
		enthroned?: boolean;
		compact?: boolean;
		kneeling?: boolean;
		onselect: (entry: CourtRank) => void;
	} = $props();
	const uid = $props.id();
	const kneeling = $derived(kneelingPose || entry.credit < 0);
	const variation = $derived([...entry.member.id].reduce((sum, char) => sum + char.charCodeAt(0), 0) % 3);
	let canvas = $state<HTMLCanvasElement>();
	let modelReady = $state(false);
	let avatarReady = $state(false);
	let grip = $state({ x: 85, y: 46 });
	// Polls replace rank/member objects every 15s. Only rebuild GPU resources if
	// the appearance changes; balances and ranking labels update independently.
	const appearance = $derived(
		JSON.stringify({
			tier: entry.tier,
			kneeling,
			member: {
				id: entry.member.id,
				name: entry.member.name,
				color: entry.member.color,
				avatarUrl: entry.member.avatarUrl
			}
		} satisfies CourtAppearance)
	);
	$effect(() => {
		const target = canvas;
		const current: CourtAppearance = JSON.parse(appearance);
		if (!target) return;
		let cancelled = false;
		let model: { dispose: () => void } | undefined;
		avatarReady = false;
		void import('$lib/graphics/court-model')
			.then(async ({ createCourtModel }) => {
				if (cancelled) return;
				const created = await createCourtModel(
					target,
					current,
					(state) => {
						if (cancelled) return;
						grip = state;
						modelReady = true;
						avatarReady = state.avatar;
					},
					() => {
						if (!cancelled) modelReady = false;
					}
				);
				if (cancelled) created.dispose();
				else model = created;
			})
			.catch(() => {
				if (!cancelled) {
					modelReady = false;
				}
			});
		return () => {
			cancelled = true;
			model?.dispose();
		};
	});
</script>

<button
	class="court-figure {entry.tier}"
	class:enthroned
	class:compact
	onclick={() => onselect(entry)}
	aria-label={`${entry.member.name}, ${entry.title}, hạng ${entry.rank}, Tổng cộng: ${currency(entry.credit)}`}
>
	<span class="figure-body" class:model-ready={modelReady} aria-hidden="true">
		<canvas
			bind:this={canvas}
			class="figure-model"
			data-renderer={modelReady ? '3d' : 'fallback'}
			data-avatar={avatarReady ? 'photo' : 'initials'}
		></canvas>
		{#if !modelReady}<span class="fallback-face" class:kneeling><Avatar member={entry.member} /></span>{/if}
		<svg viewBox="0 0 120 180" class="human-figure">
			<defs>
				<linearGradient id={`${uid}-skin`} x1="0" x2="1"
					><stop stop-color="#af7658" /><stop offset=".45" stop-color="#e8b58e" /><stop
						offset="1"
						stop-color="#c28b69"
					/></linearGradient
				>
				<linearGradient id={`${uid}-cloth`} x1="0" x2="1"
					><stop stop-color="var(--robe-dark)" /><stop offset=".4" stop-color="var(--robe)" /><stop
						offset=".7"
						stop-color="var(--robe)"
					/><stop offset="1" stop-color="var(--robe-dark)" /></linearGradient
				>
				<linearGradient id={`${uid}-gold`} x1="0" y1="0" x2="1" y2="1"
					><stop stop-color="#fbe3a1" /><stop offset=".5" stop-color="#bd914f" /><stop
						offset="1"
						stop-color="#73512e"
					/></linearGradient
				>
			</defs>
			<ellipse cx="61" cy="173" rx="47" ry="5" fill="#000" opacity=".3" />
			{#if kneeling}
				<!-- Bent knees, slumped shoulders and clasped wrists make the pose readable at phone size. -->
				<path
					d="M47 124Q25 128 24 154L34 169H66L72 158L48 151L64 139Z"
					fill="#4c3e35"
					stroke="#2d2828"
					stroke-width="2"
				/>
				<path
					d="M67 128Q88 129 91 147L87 165H110Q115 169 111 173H76Q66 168 68 153L53 146Z"
					fill="#72604c"
					stroke="#352d2a"
					stroke-width="2"
				/>
				<path d="M25 167Q39 163 46 169L49 174H24Z" fill="#292529" />
				<path
					d="M35 75Q50 64 66 79L81 126Q61 141 32 127L32 96Z"
					fill={`url(#${uid}-cloth)`}
					stroke="#362c29"
				/>
				<path
					d="M40 87L37 121M49 95L57 127M65 110L71 127"
					fill="none"
					stroke="#e0bd8d"
					stroke-opacity=".22"
					stroke-width="2"
				/>
				<path
					d="M38 81Q26 82 29 98L42 118L60 110L55 102L45 103L44 85Z"
					fill={`url(#${uid}-cloth)`}
					stroke="#49362e"
				/>
				<path d="M65 81Q75 85 78 99L69 113L59 107L66 96Z" fill={`url(#${uid}-cloth)`} stroke="#49362e" />
				<path d="M56 103Q62 99 66 104L73 108Q77 113 71 116L60 112L54 110Z" fill={`url(#${uid}-skin)`} />
				<path d="M65 105L72 110M62 107L69 113" stroke="#955c43" fill="none" />
				<g transform="rotate(23 56 65)">
					<path d="M50 59L49 76Q56 82 63 75L61 59" fill={`url(#${uid}-skin)`} />
					<path
						d="M38 40Q37 26 53 25Q72 24 74 42L70 60Q65 72 57 72Q45 67 42 57Z"
						fill={`url(#${uid}-skin)`}
					/>
					<path d="M39 48Q29 31 43 24Q58 16 72 30L76 47L68 40L62 31L53 40L42 38L43 50Z" fill="#302723" />
					<path d="M46 48L52 50M61 51L68 51" stroke="#51362b" stroke-width="2" stroke-linecap="round" />
					<path d="M56 50L55 58L59 59M53 65Q59 61 64 64" fill="none" stroke="#8d5544" stroke-width="1.5" />
					<path d="M43 56L49 58M64 60L69 60" stroke="#bc7060" stroke-width="3" opacity=".6" />
				</g>
				<g fill="none" stroke="#dfbc82" stroke-width="2.8"
					><path d="M56 101L54 110M60 102L58 113M64 104L62 114" /><path
						d="M60 112Q78 136 82 119Q82 111 64 110"
						stroke-width="1.8"
					/></g
				>
				<path d="M40 119L45 124L40 128" fill="none" stroke="#c7a580" stroke-width="1.5" />
			{:else}
				<!-- Adult proportions: a small sculpted face, articulated arms, tailored clothes and boots. -->
				{#if entry.credit > 0}<path
						d="M37 48Q60 38 80 49L99 158Q65 174 19 159Z"
						fill={`url(#${uid}-cloth)`}
						stroke="var(--trim)"
						stroke-opacity=".4"
					/>{/if}
				<path d="M42 116L59 117L57 159L44 162ZM64 116L79 116L77 160L65 160Z" fill="#302830" />
				<path
					d="M44 155L57 155L56 171L32 172Q30 167 43 164ZM65 155L77 155L80 164Q91 166 88 172H65Z"
					fill="#241f26"
					stroke="#8c7358"
					stroke-width=".8"
				/>
				<path
					d="M40 49L53 44H67L80 50L79 118Q60 128 39 117Z"
					fill={`url(#${uid}-cloth)`}
					stroke="var(--trim)"
					stroke-opacity=".5"
				/>
				<path
					d="M58 61L56 117M70 68L73 115M45 82L43 112"
					fill="none"
					stroke="#fff"
					stroke-opacity=".1"
					stroke-width="2"
				/>
				<path d="M52 40V50L60 58L68 50V39" fill={`url(#${uid}-skin)`} />
				<path d="M48 46L60 55L72 46L68 60L60 65L51 59Z" fill="var(--trim)" />
				<path
					d="M39 51Q31 49 29 65L23 94L33 99L44 71"
					fill={`url(#${uid}-cloth)`}
					stroke="var(--robe-dark)"
					stroke-width="2"
				/>
				<path d="M25 93L22 103Q22 110 28 110L32 105L33 97Z" fill={`url(#${uid}-skin)`} />
				<path
					d="M77 51Q86 50 87 63L88 80L99 78L101 88L79 94L73 71"
					fill={`url(#${uid}-cloth)`}
					stroke="var(--robe-dark)"
					stroke-width="2"
				/>
				<path d="M93 80L98 75Q103 73 107 78L108 86Q103 92 96 87Z" fill={`url(#${uid}-skin)`} />
				<path d="M100 78L104 83M97 81L102 86" fill="none" stroke="#996447" />
				<path d="M39 105Q59 110 79 105L79 112Q59 117 39 112Z" fill="#3c2d2b" /><rect
					x="56"
					y="107"
					width="9"
					height="7"
					rx="1"
					fill={`url(#${uid}-gold)`}
				/>
				{#if entry.credit > 0}<path
						d="M45 57Q44 83 61 86Q78 83 75 57"
						fill="none"
						stroke="var(--trim)"
						stroke-width="1.5"
					/><path d="M60 80L65 87L60 94L55 87Z" fill={`url(#${uid}-gold)`} />{/if}
				<ellipse cx="43" cy="29" rx="3" ry="6" fill="#b57c5a" /><ellipse
					cx="77"
					cy="29"
					rx="3"
					ry="6"
					fill="#b57c5a"
				/>
				<path d="M44 17Q47 7 60 8Q76 8 77 23L74 37Q68 49 60 49Q49 47 45 36Z" fill={`url(#${uid}-skin)`} />
				{#if variation === 0}<path
						d="M43 29Q37 9 53 5Q73 1 78 17L77 28L71 17Q55 22 49 16L46 29Z"
						fill="#332824"
					/>
				{:else if variation === 1}<path
						d="M44 31L41 18Q43 3 60 5Q81 3 79 25L75 34L71 15L52 13L47 33Z"
						fill="#40332b"
					/>
				{:else}<path d="M43 29Q40 10 50 8L71 7Q80 14 76 29L71 16Q58 25 49 19L47 30Z" fill="#272326" />{/if}
				<path d="M49 27L55 26M64 26L71 27" stroke="#594031" stroke-width="1.6" stroke-linecap="round" />
				<path d="M50 30H54M65 30H69" stroke="#2c2524" stroke-width="1.6" stroke-linecap="round" />
				<path d="M60 29L58 36L62 37M54 41Q61 44 67 40" fill="none" stroke="#945b45" stroke-width="1.2" />
				{#if entry.tier === 'sovereign'}<path
						d="M43 13L40 0L51 6L60 -3L69 6L80 0L76 13Z"
						fill={`url(#${uid}-gold)`}
						stroke="#f9df9d"
					/><path d="M45 12H75" stroke="#f2ca79" stroke-width="3" /><circle
						cx="60"
						cy="8"
						r="2.5"
						fill="#9f3d49"
					/>{/if}
				{#if entry.credit > 0}<path
						d="M103 84Q119 100 106 110Q94 112 101 91"
						fill="none"
						stroke="#d7b17a"
						stroke-width="2"
					/>{/if}
			{/if}
		</svg>
		<span
			class="rope-anchor"
			style:left={`${modelReady ? grip.x : kneeling ? 50 : 85}%`}
			style:top={`${modelReady ? grip.y : kneeling ? 60 : 46}%`}
		></span>
	</span>
	<span class="figure-caption"
		><small>{entry.title}</small><strong title={entry.member.name}
			><Avatar member={entry.member} size="small" />{entry.member.name}</strong
		>
		{#if !compact}<span class="figure-amount">{currency(Math.abs(entry.credit))}</span>{/if}
	</span>
</button>

<style>
	.court-figure {
		--robe: #815d96;
		--robe-dark: #302339;
		--trim: #ddbd7b;
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
		--robe: #a54758;
		--robe-dark: #440f27;
		--trim: #ffdc8b;
	}
	.commoner {
		--robe: #538b80;
		--robe-dark: #243e3c;
		--trim: #b3d4c1;
	}
	.servant {
		--robe: #93816b;
		--robe-dark: #463b32;
		--trim: #c6ad8e;
	}
	.figure-body {
		position: relative;
		display: block;
		flex-shrink: 0;
		width: 110px;
		height: 165px;
		filter: drop-shadow(0 8px 6px #0005);
		transition: filter 0.2s ease;
	}
	.human-figure {
		display: block;
		width: 100%;
		height: 100%;
		overflow: visible;
	}
	.rope-anchor {
		position: absolute;
		width: 0;
		height: 0;
	}
	.figure-model {
		position: absolute;
		inset: 0;
		width: 100%;
		height: 100%;
		opacity: 0;
	}
	.model-ready .figure-model {
		opacity: 1;
	}
	.model-ready .human-figure {
		visibility: hidden;
	}
	.fallback-face {
		position: absolute;
		z-index: 1;
		left: 36%;
		top: 6%;
		width: 29%;
		height: 22%;
		overflow: hidden;
		border-radius: 46%;
	}
	.fallback-face.kneeling {
		left: 34%;
		top: 20%;
		transform: rotate(23deg);
	}
	.fallback-face :global(.avatar) {
		width: 100%;
		height: 100%;
		font-size: 10px;
	}
	.court-figure:hover .figure-body {
		filter: drop-shadow(0 6px 9px #e5b45b40);
	}
	.court-figure:focus-visible {
		outline: 2px solid #f0ce88;
		outline-offset: 5px;
		border-radius: 8px;
	}
	.figure-caption {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 4px;
		width: 100%;
		margin-top: 7px;
		text-shadow: 0 2px 5px #120d19;
	}
	.figure-caption small {
		color: var(--trim);
		font-size: 10px;
		letter-spacing: 0.04em;
	}
	.figure-caption strong {
		display: flex;
		align-items: center;
		gap: 5px;
		max-width: 100%;
		font-size: 12px;
		font-weight: 600;
		overflow: hidden;
		white-space: nowrap;
	}
	.figure-caption strong :global(.avatar) {
		flex-shrink: 0;
		width: 18px;
		height: 18px;
		font-size: 7px;
		border: 1px solid #d5b78566;
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
	.compact .figure-body {
		width: 90px;
		height: 135px;
	}
	.compact .figure-caption {
		margin-top: 4px;
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
	}
	@media (prefers-reduced-motion: reduce) {
		.figure-body {
			transition: none;
		}
	}
</style>
