<script lang="ts">
	import { tick } from 'svelte';
	import {
		Crown,
		Gem,
		Sprout,
		Feather,
		Sparkles,
		ChevronRight,
		ArrowUpRight,
		ScrollText,
		Crosshair,
		Users,
		Scale
	} from '@lucide/svelte';
	import Avatar from '../Avatar.svelte';
	import CourtFigure from '../CourtFigure.svelte';
	import Modal from '../Modal.svelte';
	import type { AppState } from '$lib/domain/types';
	import { courtRanking, type CourtRank, type CourtTier } from '$lib/domain/leaderboard';
	import { currency, pairBalance } from '$lib/domain/ledger';

	let { appState, actor, groupName }: { appState: AppState; actor: string; groupName: string } = $props();
	let effects = $state(true);
	let viewAngle = $state(0);
	let filter = $state<'all' | 'creditors' | 'commoner' | 'servant'>('all');
	let selectedId = $state<string | null>(null);
	let profileOpen = $state(false);
	let rankList: HTMLDivElement;
	const ranks = $derived(courtRanking(appState.members, appState.ledger));
	const monarch = $derived(ranks.find((entry) => entry.tier === 'sovereign'));
	const courtiers = $derived(ranks.filter((entry) => entry.member.id !== monarch?.member.id).slice(0, 2));
	const courtIds = $derived(new Set([monarch?.member.id, ...courtiers.map((entry) => entry.member.id)]));
	const gathering = $derived(ranks.filter((entry) => !courtIds.has(entry.member.id)).slice(-3));
	const ownRank = $derived(ranks.find((entry) => entry.member.id === actor));
	const selected = $derived(ranks.find((entry) => entry.member.id === selectedId));
	const coMonarchs = $derived(ranks.filter((entry) => entry.tier === 'sovereign').length);
	const creditors = $derived(ranks.filter((entry) => entry.credit > 0).length);
	const debtors = $derived(ranks.filter((entry) => entry.credit < 0).length);
	const filters = $derived([
		{ id: 'all' as const, label: 'Toàn triều', count: ranks.length },
		{ id: 'creditors' as const, label: 'Hoàng tộc', count: creditors },
		{
			id: 'commoner' as const,
			label: 'Thường dân',
			count: ranks.filter((entry) => entry.credit === 0).length
		},
		{ id: 'servant' as const, label: 'Nô bộc', count: debtors }
	]);
	const visible = $derived(
		ranks.filter(
			(entry) => filter === 'all' || (filter === 'creditors' ? entry.credit > 0 : entry.tier === filter)
		)
	);
	const balanceDetails = $derived.by(() => {
		if (!selected) return { owing: 0, owed: 0 };
		return appState.members.reduce(
			(total, member) => {
				const balance = pairBalance(appState.ledger, selected.member.id, member.id);
				return { owing: total.owing + Math.max(0, balance), owed: total.owed + Math.max(0, -balance) };
			},
			{ owing: 0, owed: 0 }
		);
	});
	const emblem = (tier: CourtTier) =>
		tier === 'sovereign' ? Crown : tier === 'noble' ? Gem : tier === 'commoner' ? Sprout : Feather;
	function summon(entry: CourtRank) {
		selectedId = entry.member.id;
		profileOpen = true;
	}
	async function findMe() {
		filter = 'all';
		await tick();
		const row = rankList?.querySelector<HTMLButtonElement>('[data-self="true"]');
		row?.scrollIntoView({
			block: 'center',
			behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth'
		});
		row?.focus({ preventScroll: true });
	}
</script>

<div class="royal-court" class:effects-off={!effects}>
	<section class="royal-hero" aria-label="Đại điện hoàng gia">
		<div class="royal-topline">
			<span class="court-group"><Crown size={14} /><span>{groupName}</span></span>
			<button
				class="effects-button"
				aria-label="Hiệu ứng đại điện"
				aria-pressed={effects}
				onclick={() => (effects = !effects)}><Sparkles size={15} /><span>Hiệu ứng</span></button
			>
		</div>
		<header class="court-heading">
			<p class="court-eyebrow"><span></span> ĐẠI ĐIỆN HOÀNG GIA <span></span></p>
			<h1>Bảng xếp hạng</h1>
			<p>Ngai vàng đổi chủ. Sổ nợ lên ngôi.</p>
		</header>
		<div class="palace-stage">
			<div class="palace-world" style:--court-angle={`${viewAngle}deg`}>
				<svg class="palace-architecture" viewBox="0 0 720 500" preserveAspectRatio="none" aria-hidden="true">
					<defs>
						<linearGradient id="court-column" x1="0" x2="1"
							><stop stop-color="#292231" /><stop offset=".4" stop-color="#665044" /><stop
								offset=".55"
								stop-color="#8b6d4c"
							/><stop offset="1" stop-color="#231e2a" /></linearGradient
						>
						<linearGradient id="court-velvet" x1="0" x2="1"
							><stop stop-color="#240d20" /><stop offset=".45" stop-color="#72263c" /><stop
								offset=".7"
								stop-color="#491329"
							/><stop offset="1" stop-color="#280f23" /></linearGradient
						>
						<linearGradient id="court-gold" x1="0" y1="0" x2="1" y2="1"
							><stop stop-color="#fff0b3" /><stop offset=".3" stop-color="#d4a455" /><stop
								offset=".65"
								stop-color="#92642e"
							/><stop offset="1" stop-color="#e9c67b" /></linearGradient
						>
						<radialGradient id="court-light"
							><stop stop-color="#efb957" stop-opacity=".2" /><stop
								offset="1"
								stop-color="#efb957"
								stop-opacity="0"
							/></radialGradient
						>
					</defs>
					<ellipse cx="360" cy="160" rx="250" ry="230" fill="url(#court-light)" />
					<g fill="none" stroke="#a27a4a" stroke-opacity=".3">
						<path d="M190 350V156Q190 68 360 10Q530 68 530 156V350" stroke-width="3" />
						<path d="M205 350V160Q205 83 360 26Q515 83 515 160V350" />
						<path d="M223 350V165Q223 99 360 43Q497 99 497 165V350" stroke-width="2" />
						<path d="M250 310V168Q250 124 360 65Q470 124 470 168V310" stroke-opacity=".15" />
						<path d="M360 45V279M260 120L460 290M460 120L260 290" stroke-opacity=".1" />
					</g>
					<g fill="url(#court-velvet)">
						<path d="M0 0H162Q157 105 102 193Q77 230 16 245L0 360Z" />
						<path d="M720 0H558Q563 105 618 193Q643 230 704 245L720 360Z" />
					</g>
					<g fill="none" stroke="#c69b55" stroke-opacity=".55" stroke-width="2">
						<path d="M155 0Q144 168 20 237M565 0Q576 168 700 237" />
						<path d="M25 234L67 211M695 234L653 211" stroke-width="6" />
					</g>
					<g fill="url(#court-column)">
						<path d="M110 30H144V335H110ZM576 30H610V335H576Z" />
						<path d="M100 24H154V42H100ZM566 24H620V42H566ZM100 328H154V345H100ZM566 328H620V345H566Z" />
					</g>
					<g fill="#c7a065" opacity=".45"><path d="M120 49H123V320H120ZM597 49H600V320H597Z" /></g>
					<g stroke="#b88a4b" fill="#b88a4b"
						><path d="M165 234V267M155 243H175M555 234V267M545 243H565" stroke-width="3" /><path
							d="M155 267H175L165 279ZM545 267H565L555 279Z"
						/></g
					>
					<g class="torch-flames" fill="#ffc777"
						><path
							d="M165 208Q149 228 165 237Q180 229 165 208ZM555 208Q539 228 555 237Q570 229 555 208Z"
						/></g
					>
					<g fill="url(#court-light)"
						><circle cx="165" cy="225" r="70" /><circle cx="555" cy="225" r="70" /></g
					>
					<path d="M247 299H473L500 317H220Z" fill="#6e4b38" stroke="#bd9558" stroke-opacity=".6" />
					<path d="M220 317H500V330H220Z" fill="#382832" />
					<path d="M220 330H500L533 351H187Z" fill="#624334" stroke="#bd9558" stroke-opacity=".4" />
					<path d="M187 351H533V363H187Z" fill="#2b202b" />
				</svg>
				<div class="palace-floor" aria-hidden="true"></div>
				<div class="royal-carpet" aria-hidden="true"></div>
				<div class="palace-dust" aria-hidden="true">
					{#each [12, 26, 41, 60, 74, 89] as left, index}<i
							style:left={`${left}%`}
							style:--delay={`${index * -0.9}s`}
						></i>{/each}
				</div>
				<svg class="royal-throne" viewBox="0 0 160 220" aria-hidden="true">
					<path d="M23 171V49L39 25L59 30L80 4L101 30L121 25L137 49V171Z" fill="url(#court-gold)" />
					<path d="M32 164V53L44 36L62 40L80 19L98 40L116 36L128 53V164Z" fill="#571c30" />
					<path d="M44 155V59Q80 27 116 59V155Z" fill="#772b3f" stroke="#ba884e" />
					<g fill="#d6ac67"
						><circle cx="60" cy="76" r="2" /><circle cx="100" cy="76" r="2" /><circle
							cx="80"
							cy="100"
							r="2"
						/><circle cx="60" cy="124" r="2" /><circle cx="100" cy="124" r="2" /></g
					>
					<path d="M16 140L37 151V179L16 171ZM144 140L123 151V179L144 171Z" fill="#ab783c" />
					<path d="M13 136H35V149H13ZM125 136H147V149H125Z" fill="url(#court-gold)" />
					<path d="M25 164H135L142 185H18Z" fill="#a8713c" />
					<path d="M18 185H142V200H18Z" fill="url(#court-gold)" />
					<path d="M25 199H40L35 218H22ZM120 199H135L138 218H125Z" fill="#d0a15e" />
				</svg>
				{#if monarch}
					<div class="throne-occupant"><CourtFigure entry={monarch} enthroned onselect={summon} /></div>
				{:else}
					<div class="vacant-throne">
						<Crown size={34} /><strong>Ngai vàng đang chờ</strong><span
							>{ranks.length ? 'Chưa có chủ nợ ròng' : 'Chưa có thành viên'}</span
						>
					</div>
				{/if}
				{#each courtiers as entry, index (entry.member.id)}<div
						class="courtier"
						class:courtier-right={index === 1}
					>
						<CourtFigure {entry} onselect={summon} />
					</div>{/each}
				<div class="court-gathering">
					{#each gathering as entry (entry.member.id)}<div>
							<CourtFigure {entry} compact onselect={summon} />
						</div>{/each}
				</div>
			</div>
		</div>
		<div class="stage-caption">
			<span></span><Sparkles size={12} />{coMonarchs > 1
				? `${coMonarchs} quân vương cùng hạng nhất`
				: 'Chạm nhân vật để xem sắc phong'}<span></span>
		</div>
		<div class="court-perspective">
			<label for="court-angle">Góc nhìn</label>
			<input
				id="court-angle"
				aria-label="Góc nhìn đại điện"
				type="range"
				min="-12"
				max="12"
				step="1"
				bind:value={viewAngle}
			/>
			<button onclick={() => (viewAngle = 0)} disabled={viewAngle === 0} aria-label="Đặt lại góc nhìn"
				>Chính diện</button
			>
		</div>
		<div class="court-census">
			<div><Users size={15} /><strong>{ranks.length}</strong><span>thành viên</span></div>
			<div><Crown size={15} /><strong>{creditors}</strong><span>chủ nợ</span></div>
			<div><Feather size={15} /><strong>{debtors}</strong><span>con nợ</span></div>
		</div>
	</section>

	{#if ownRank}
		<button class="own-proclamation" onclick={() => summon(ownRank)}>
			<span class="proclamation-seal"><ScrollText size={22} /></span>
			<span class="own-title"
				><small>SẮC PHONG CỦA BẠN</small><strong>{ownRank.title} <span>· Hạng {ownRank.rank}</span></strong
				></span
			>
			<ChevronRight size={18} />
		</button>
	{/if}

	<section class="court-register" aria-labelledby="register-title">
		<div class="register-heading">
			<div>
				<p class="court-eyebrow">SỔ BỘ TRIỀU ĐÌNH</p>
				<h2 id="register-title">Quần thần tề tựu</h2>
			</div>
			{#if ownRank}<button class="find-me" onclick={findMe}><Crosshair size={15} /> Tìm tôi</button>{/if}
		</div>
		<div class="court-filters" role="group" aria-label="Lọc tước vị">
			{#each filters as item}<button
					class:chosen={filter === item.id}
					aria-pressed={filter === item.id}
					onclick={() => (filter = item.id)}>{item.label}<span>{item.count}</span></button
				>{/each}
		</div>
		<div class="register-columns"><span>THỨ BẬC / TƯỚC VỊ</span><span>NỢ − BỊ NỢ</span></div>
		<div class="rank-list" bind:this={rankList}>
			{#each visible as entry (entry.member.id)}
				{@const Emblem = emblem(entry.tier)}
				<button
					class="rank-row {entry.tier}"
					class:own-row={entry.member.id === actor}
					data-self={entry.member.id === actor}
					onclick={() => summon(entry)}
					aria-label={`${entry.member.name}, ${entry.title}, hạng ${entry.rank}`}
				>
					<span class="rank-number">{entry.rank < 10 ? `0${entry.rank}` : entry.rank}</span>
					<span class="rank-avatar"
						><Avatar member={entry.member} />{#if entry.tier === 'sovereign'}<Crown size={13} />{/if}</span
					>
					<span class="rank-identity"
						><strong
							>{entry.member.name}{#if entry.member.id === actor}<em>Bạn</em>{/if}</strong
						><small><Emblem size={12} />{entry.title}</small></span
					>
					<span class="rank-balance" class:credit={entry.credit > 0} class:debt={entry.credit < 0}
						><strong>{currency(0 - entry.credit)}</strong><small
							>{entry.credit > 0 ? 'Được nhận' : entry.credit < 0 ? 'Cần trả' : 'Đã cân bằng'}</small
						></span
					>
					<ChevronRight size={14} class="rank-chevron" />
				</button>
			{:else}<div class="court-empty">
					<ScrollText size={28} />
					<p>
						{ranks.length ? 'Chưa có ai mang tước vị này.' : 'Triều đình đang chờ những thành viên đầu tiên.'}
					</p>
				</div>{/each}
		</div>
	</section>
	<details class="court-rules">
		<summary><Scale size={17} /><span>Luật phong tước</span><ChevronRight size={16} /></summary>
		<div class="rules-content">
			<p>
				Thứ bậc dựa trên <strong>Nợ − bị nợ</strong>, từ thấp đến cao. Số âm là tiền được nhận; số dương là
				tiền cần trả.
			</p>
			<dl>
				<div>
					<dt><Crown size={15} /> Quân vương</dt>
					<dd>Người được nhận ròng nhiều nhất, lớn hơn 0 ₫.</dd>
				</div>
				<div>
					<dt><Gem size={15} /> Quý tộc</dt>
					<dd>Các chủ nợ còn lại. Hạng 2 là Công tước, hạng 3 là Hầu tước.</dd>
				</div>
				<div>
					<dt><Sprout size={15} /> Thường dân</dt>
					<dd>Nợ và bị nợ cân bằng nhau.</dd>
				</div>
				<div>
					<dt><Feather size={15} /> Nô bộc</dt>
					<dd>Tiền cần trả nhiều hơn tiền được nhận.</dd>
				</div>
			</dl>
			<p>
				Chỉ xếp hạng thành viên đang hoạt động. Số dư vẫn tính toàn bộ giao dịch. Cùng số dư, cùng thứ hạng và
				tước vị.
			</p>
		</div>
	</details>
	<div class="court-endmark" aria-hidden="true"><span></span><Crown size={17} /><span></span></div>
</div>

<Modal bind:open={profileOpen} title="Sắc phong" compact>
	{#if selected}
		{@const Emblem = emblem(selected.tier)}
		<div class="royal-profile">
			<div class="profile-emblem"><Emblem size={30} /></div>
			<p class="profile-title">{selected.title} · Hạng {selected.rank}</p>
			<div class="profile-avatar"><Avatar member={selected.member} size="large" /></div>
			<h2>{selected.member.name}</h2>
			<p class="profile-subtitle">
				{selected.credit > 0
					? 'Ngân khố đang chờ người hoàn trả.'
					: selected.credit < 0
						? 'Hoàn trả nợ để đổi vận trong triều.'
						: 'Sổ nợ cân bằng. Tự tại giữa nhân gian.'}
			</p>
			<dl class="profile-balances">
				<div>
					<dt>Đang nợ</dt>
					<dd>{currency(balanceDetails.owing)}</dd>
				</div>
				<div>
					<dt>Đang bị nợ</dt>
					<dd>{currency(balanceDetails.owed)}</dd>
				</div>
				<div class="profile-net">
					<dt>Nợ − bị nợ</dt>
					<dd>{currency(0 - selected.credit)}</dd>
				</div>
			</dl>
			<a class="profile-account" href={`/balances?member=${encodeURIComponent(selected.member.id)}`}
				>Xem tài khoản<ArrowUpRight size={17} /></a
			>
		</div>
	{/if}
</Modal>

<style>
	.royal-court {
		--gold: #e9c580;
		--muted-gold: #b9a186;
		--royal-line: #d8b16b26;
		color: #f6ead9;
		background: #17131e;
		border: 1px solid #c99d5638;
		border-radius: 22px;
		overflow: clip;
		box-shadow: 0 18px 65px #24132614;
		isolation: isolate;
		color-scheme: dark;
	}
	.royal-court button {
		font-family: inherit;
	}
	.royal-court button:focus-visible,
	.court-rules summary:focus-visible {
		outline: 2px solid var(--gold);
		outline-offset: -3px;
	}
	.royal-hero {
		position: relative;
		background:
			radial-gradient(ellipse at 50% 30%, #53392d77, transparent 58%),
			linear-gradient(180deg, #211724, #191421);
		overflow: clip;
	}
	.royal-topline {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 12px;
		padding: 17px 18px 0;
	}
	.court-group {
		display: flex;
		align-items: center;
		gap: 7px;
		min-width: 0;
		color: var(--gold);
		font-size: 11px;
	}
	.court-group span {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.court-group :global(svg) {
		flex-shrink: 0;
	}
	.effects-button {
		display: flex;
		align-items: center;
		gap: 5px;
		flex-shrink: 0;
		color: #c2ad95;
		font-size: 10px;
		padding: 8px;
		border: 1px solid var(--royal-line);
		border-radius: 20px;
		background: #100c1529;
		cursor: pointer;
		min-height: 36px;
	}
	.effects-button[aria-pressed='false'] {
		color: #8c8194;
	}
	.court-heading {
		position: relative;
		z-index: 1;
		padding: 23px 12px 0;
		text-align: center;
	}
	.court-eyebrow {
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 10px;
		margin: 0;
		color: var(--gold);
		font-size: 9px;
		letter-spacing: 0.2em;
		font-weight: 600;
	}
	.court-heading .court-eyebrow span {
		display: block;
		width: 22px;
		height: 1px;
		background: linear-gradient(90deg, transparent, #bd914f);
	}
	.court-heading .court-eyebrow span:last-child {
		transform: rotate(180deg);
	}
	.court-heading h1 {
		font-family: 'Times New Roman', 'Times New Roman', serif;
		font-size: clamp(29px, 6vw, 46px);
		font-weight: 400;
		line-height: 1.3;
		letter-spacing: -0.035em;
		color: #ffeac5;
		margin: 8px 0;
		text-shadow: 0 2px 28px #e6ab5d29;
	}
	.court-heading > p:last-child {
		margin: 0;
		font-size: 11px;
		color: var(--muted-gold);
	}
	.palace-stage {
		position: relative;
		height: 494px;
		max-width: 820px;
		margin: 4px auto 0;
		perspective: 800px;
	}
	.palace-world {
		position: absolute;
		inset: 0;
		transform: rotateY(var(--court-angle));
		transform-style: preserve-3d;
	}
	.palace-architecture {
		position: absolute;
		inset: 0;
		width: 100%;
		height: 100%;
		pointer-events: none;
		transform: translateZ(-15px);
	}
	.palace-floor {
		position: absolute;
		left: -30%;
		right: -30%;
		bottom: -35px;
		height: 180px;
		background:
			repeating-linear-gradient(0deg, transparent 0 35px, #b8905024 36px 37px),
			repeating-linear-gradient(90deg, #2b233044 0 57px, #b8905024 58px 59px);
		transform: rotateX(58deg);
		transform-origin: center;
		mask-image: linear-gradient(transparent, #000 35%, transparent);
		pointer-events: none;
	}
	.royal-carpet {
		position: absolute;
		left: 25%;
		right: 25%;
		top: 314px;
		bottom: -4px;
		clip-path: polygon(30% 0, 70% 0, 100% 100%, 0 100%);
		background: linear-gradient(90deg, #b3854659, #681f3644 6% 94%, #b3854659);
		opacity: 0.7;
		pointer-events: none;
	}
	.royal-throne {
		position: absolute;
		left: 50%;
		top: 28px;
		width: 138px;
		height: 190px;
		transform: translateX(-50%);
		filter: drop-shadow(0 12px 9px #0005);
		pointer-events: none;
	}
	.throne-occupant {
		position: absolute;
		z-index: 2;
		top: 82px;
		left: 30%;
		width: 40%;
		transform: translateZ(12px);
	}
	.courtier {
		position: absolute;
		z-index: 3;
		top: 185px;
		left: 4%;
		width: 28%;
		transform: translateZ(22px);
	}
	.courtier-right {
		left: auto;
		right: 4%;
	}
	.court-gathering {
		position: absolute;
		z-index: 4;
		top: 365px;
		left: 9%;
		right: 9%;
		display: flex;
		justify-content: space-evenly;
		gap: 10px;
		transform: translateZ(32px);
	}
	.court-gathering > div {
		width: 29%;
		min-width: 0;
		max-width: 120px;
	}
	.vacant-throne {
		position: absolute;
		z-index: 2;
		top: 102px;
		left: 25%;
		width: 50%;
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 9px;
		color: var(--gold);
		text-align: center;
	}
	.vacant-throne strong {
		margin-top: 61px;
		font-family: 'Times New Roman', serif;
		font-weight: 400;
		font-size: 17px;
	}
	.vacant-throne span {
		font-size: 10px;
		color: var(--muted-gold);
	}
	.palace-dust {
		position: absolute;
		inset: 0;
		pointer-events: none;
		overflow: hidden;
	}
	.palace-dust i {
		position: absolute;
		top: 70%;
		width: 3px;
		height: 3px;
		border-radius: 50%;
		background: #ffdda2;
		box-shadow: 0 0 10px 2px #ffd48255;
		animation: court-drift 8s linear infinite;
		animation-delay: var(--delay);
		opacity: 0;
	}
	.torch-flames {
		animation: court-flicker 3s ease-in-out infinite alternate;
		transform-box: fill-box;
		transform-origin: bottom;
	}
	.stage-caption {
		position: relative;
		display: flex;
		justify-content: center;
		align-items: center;
		gap: 7px;
		color: #b9a086;
		padding: 0 12px 10px;
		font-size: 9px;
		letter-spacing: 0.02em;
	}
	.stage-caption > span {
		width: 20px;
		height: 1px;
		background: var(--royal-line);
	}
	.court-perspective {
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 12px;
		padding: 0 18px 14px;
		font-size: 10px;
		color: var(--muted-gold);
	}
	.court-perspective input {
		width: 105px;
		min-width: 0;
		height: 36px;
		accent-color: #d9b776;
		cursor: ew-resize;
	}
	.court-perspective button {
		color: var(--gold);
		background: none;
		border: 0;
		padding: 10px 0;
		font-size: 10px;
	}
	.court-perspective button:disabled {
		opacity: 0.45;
	}
	.court-census {
		display: grid;
		grid-template-columns: repeat(3, 1fr);
		padding: 16px 8px;
		border-block: 1px solid var(--royal-line);
		background: #0f0c1233;
	}
	.court-census > div {
		display: flex;
		justify-content: center;
		align-items: center;
		flex-wrap: wrap;
		gap: 5px;
		color: var(--gold);
		font-size: 11px;
	}
	.court-census > div + div {
		border-left: 1px solid var(--royal-line);
	}
	.court-census strong {
		font-weight: 600;
		font-size: 14px;
	}
	.court-census span {
		color: var(--muted-gold);
		font-size: 10px;
	}
	.own-proclamation {
		display: flex;
		align-items: center;
		gap: 12px;
		width: calc(100% - 32px);
		margin: 20px 16px 0;
		padding: 14px 12px;
		color: var(--gold);
		border: 1px solid #aa7b483f;
		border-radius: 12px;
		background: linear-gradient(110deg, #54332266, #2c2333);
		text-align: left;
		cursor: pointer;
	}
	.proclamation-seal {
		display: grid;
		place-items: center;
		width: 38px;
		height: 38px;
		flex-shrink: 0;
		border: 1px solid #c49c5466;
		border-radius: 50%;
		background: #b8862e12;
	}
	.own-title {
		flex: 1;
		min-width: 0;
	}
	.own-title small {
		display: block;
		font-size: 8px;
		letter-spacing: 0.16em;
		margin-bottom: 5px;
		color: #c3a985;
	}
	.own-title strong {
		display: block;
		font-size: 13px;
		font-weight: 500;
	}
	.own-title strong span {
		font-weight: 400;
		color: #ae9c8e;
		font-size: 11px;
	}
	.court-register {
		padding: 28px 16px 0;
	}
	.register-heading {
		display: flex;
		justify-content: space-between;
		align-items: center;
		gap: 10px;
	}
	.register-heading .court-eyebrow {
		justify-content: flex-start;
		font-size: 8px;
		color: #af926e;
	}
	.register-heading h2 {
		font-family: 'Times New Roman', 'Times New Roman', serif;
		font-size: 24px;
		color: #f6e5cc;
		font-weight: 400;
		margin: 7px 0 0;
		letter-spacing: -0.02em;
	}
	.find-me {
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 5px;
		color: var(--gold);
		background: none;
		border: 1px solid var(--royal-line);
		border-radius: 20px;
		padding: 10px;
		font-size: 11px;
		white-space: nowrap;
		cursor: pointer;
		min-height: 40px;
	}
	.court-filters {
		display: flex;
		gap: 4px;
		overflow-x: auto;
		scrollbar-width: thin;
		padding: 18px 0 12px;
	}
	.court-filters button {
		display: flex;
		align-items: center;
		gap: 5px;
		flex-shrink: 0;
		padding: 9px 10px;
		min-height: 40px;
		border: 1px solid transparent;
		border-radius: 7px;
		color: #ad9eaf;
		background: #231e2a;
		font-size: 10px;
		cursor: pointer;
	}
	.court-filters span {
		font-size: 9px;
		opacity: 0.65;
	}
	.court-filters .chosen {
		color: #f8d699;
		border-color: #aa7d4659;
		background: #6b4c2c3d;
	}
	.register-columns {
		display: flex;
		justify-content: space-between;
		gap: 10px;
		padding: 10px 0;
		color: #948498;
		font-size: 8px;
		letter-spacing: 0.1em;
		border-bottom: 1px solid var(--royal-line);
	}
	.register-columns span:last-child {
		padding-right: 8px;
	}
	.rank-row {
		display: flex;
		align-items: center;
		gap: 9px;
		width: 100%;
		text-align: left;
		padding: 15px 2px;
		border: 0;
		border-bottom: 1px solid #c3a17014;
		background: transparent;
		color: #efdfcb;
		cursor: pointer;
		transition: background 0.18s;
		min-height: 78px;
	}
	.rank-row:hover,
	.rank-row:focus-visible {
		background: #c5a1740c;
	}
	.rank-row.own-row {
		background: linear-gradient(90deg, #b8904912, transparent);
	}
	.rank-number {
		width: 20px;
		flex-shrink: 0;
		font-family: 'Times New Roman', serif;
		font-size: 16px;
		color: #8d798d;
		text-align: center;
		font-variant-numeric: tabular-nums;
	}
	.sovereign .rank-number {
		color: #f0cc82;
	}
	.rank-avatar {
		position: relative;
		flex-shrink: 0;
	}
	.rank-avatar :global(.avatar) {
		width: 32px;
		height: 32px;
		font-size: 11px;
	}
	.rank-avatar :global(> svg) {
		position: absolute;
		top: -10px;
		left: 10px;
		color: #f2ce7b;
		fill: #a97e32;
		transform: rotate(-10deg);
	}
	.rank-identity {
		flex: 1;
		min-width: 0;
	}
	.rank-identity > strong {
		display: block;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		font-size: 12px;
		font-weight: 500;
	}
	.rank-identity em {
		display: inline-block;
		margin-left: 5px;
		font-size: 8px;
		font-style: normal;
		color: #d5c095;
		vertical-align: 1px;
	}
	.rank-identity small {
		display: flex;
		align-items: center;
		gap: 4px;
		margin-top: 6px;
		font-size: 10px;
		color: #9e8fa5;
	}
	.sovereign .rank-identity small {
		color: #e4bd72;
	}
	.noble .rank-identity small {
		color: #c3a5df;
	}
	.commoner .rank-identity small {
		color: #90b6a9;
	}
	.servant .rank-identity small {
		color: #b99c81;
	}
	.rank-balance {
		flex-shrink: 0;
		text-align: right;
	}
	.rank-balance strong {
		font-size: 12px;
		font-weight: 500;
		color: #b4a9b9;
		font-variant-numeric: tabular-nums;
	}
	.rank-balance.credit strong {
		color: #eaca8b;
	}
	.rank-balance.debt strong {
		color: #e4a38d;
	}
	.rank-balance small {
		display: block;
		font-size: 9px;
		color: #8f7d93;
		margin-top: 6px;
	}
	.rank-row :global(.rank-chevron) {
		color: #76657b;
		flex-shrink: 0;
		display: none;
	}
	.court-empty {
		text-align: center;
		padding: 36px 20px;
		color: #ae9aaf;
		font-size: 12px;
	}
	.court-empty :global(svg) {
		margin: 0 auto 12px;
		color: #c5a374;
	}
	.court-rules {
		margin: 20px 16px 0;
		border: 1px solid var(--royal-line);
		border-radius: 10px;
		background: #211b27;
	}
	.court-rules summary {
		display: flex;
		align-items: center;
		gap: 9px;
		padding: 14px;
		font-size: 12px;
		color: #c6ae8c;
		cursor: pointer;
		list-style: none;
	}
	.court-rules summary::-webkit-details-marker {
		display: none;
	}
	.court-rules summary span {
		flex: 1;
	}
	.court-rules[open] summary > :global(svg:last-child) {
		transform: rotate(90deg);
	}
	.rules-content {
		padding: 0 15px 15px;
		font-size: 12px;
		line-height: 1.7;
		color: #b2a3b6;
	}
	.rules-content p {
		margin: 0;
	}
	.rules-content dl {
		margin: 17px 0;
	}
	.rules-content dl > div {
		margin-top: 13px;
	}
	.rules-content dt {
		display: flex;
		align-items: center;
		gap: 7px;
		color: #dfc596;
	}
	.rules-content dd {
		margin: 3px 0 0 22px;
	}
	.court-endmark {
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 12px;
		padding: 26px;
		color: #7f6340;
	}
	.court-endmark span {
		width: 42px;
		height: 1px;
		background: var(--royal-line);
	}
	.effects-off .palace-dust i,
	.effects-off .torch-flames {
		animation: none;
	}
	.royal-profile {
		background: radial-gradient(ellipse at 50% 0, #68472666, transparent 65%), #211824;
		color: #f3e1c9;
		border-radius: 12px;
		padding: 24px 20px 20px;
		text-align: center;
	}
	.profile-emblem {
		display: flex;
		justify-content: center;
		color: #edca81;
	}
	.profile-title {
		color: #dfb971;
		font-size: 13px;
		margin: 9px 0 17px;
	}
	.profile-avatar {
		width: 68px;
		height: 68px;
		border: 2px solid #c29c5f;
		border-radius: 50%;
		padding: 3px;
		margin: auto;
	}
	.profile-avatar :global(.avatar) {
		width: 100%;
		height: 100%;
	}
	.royal-profile h2 {
		font:
			26px/1.3 Georgia,
			serif;
		margin: 14px 0 8px;
		color: #fff0d6;
		overflow-wrap: anywhere;
	}
	.profile-subtitle {
		color: #b8a4b2;
		font-size: 12px;
		line-height: 1.6;
		margin: 0;
	}
	.profile-balances {
		margin: 22px 0;
		text-align: left;
		font-size: 13px;
	}
	.profile-balances > div {
		display: flex;
		justify-content: space-between;
		gap: 10px;
		padding: 11px 0;
	}
	.profile-balances dt {
		color: #b8a4b2;
	}
	.profile-balances dd {
		margin: 0;
		font-variant-numeric: tabular-nums;
	}
	.profile-balances .profile-net {
		border-top: 1px solid #e0bd7833;
		margin-top: 4px;
		color: #e9c580;
	}
	.profile-account {
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 8px;
		padding: 13px;
		background: linear-gradient(110deg, #ebca8b, #bd8e50);
		border-radius: 7px;
		color: #30221d;
		font-size: 13px;
		font-weight: 600;
	}
	@keyframes court-drift {
		0% {
			transform: translate(0, 0);
			opacity: 0;
		}
		20% {
			opacity: 0.65;
		}
		80% {
			opacity: 0.4;
		}
		100% {
			transform: translate(16px, -210px);
			opacity: 0;
		}
	}
	@keyframes court-flicker {
		0%,
		100% {
			opacity: 0.65;
			transform: scaleY(0.9);
		}
		50% {
			opacity: 1;
			transform: scaleY(1.08);
		}
	}
	@media (min-width: 600px) {
		.royal-topline {
			padding: 22px 30px 0;
		}
		.court-heading {
			padding-top: 12px;
		}
		.court-heading > p:last-child {
			font-size: 13px;
		}
		.court-eyebrow {
			font-size: 10px;
		}
		.court-group,
		.effects-button {
			font-size: 12px;
		}
		.palace-stage {
			height: 480px;
		}
		.throne-occupant {
			top: 89px;
		}
		.royal-throne {
			top: 30px;
			width: 154px;
			height: 212px;
		}
		.courtier {
			top: 199px;
			left: 10%;
			width: 25%;
		}
		.courtier-right {
			left: auto;
			right: 10%;
		}
		.court-gathering {
			top: 347px;
			left: 19%;
			right: 19%;
		}
		.royal-carpet {
			top: 335px;
		}
		.stage-caption {
			font-size: 11px;
		}
		.court-census {
			padding: 20px;
		}
		.court-census > div {
			gap: 9px;
		}
		.court-census span {
			font-size: 12px;
		}
		.court-census strong {
			font-size: 16px;
		}
		.own-proclamation {
			width: calc(100% - 60px);
			margin: 25px 30px 0;
			padding: 17px;
		}
		.own-title strong {
			font-size: 16px;
		}
		.own-title small {
			font-size: 9px;
		}
		.court-register {
			padding: 32px 30px 0;
		}
		.register-heading h2 {
			font-size: 30px;
		}
		.register-heading .court-eyebrow {
			font-size: 9px;
		}
		.court-filters {
			gap: 8px;
		}
		.court-filters button {
			padding: 10px 16px;
			font-size: 12px;
		}
		.register-columns {
			font-size: 10px;
		}
		.rank-row {
			padding: 18px 10px;
			gap: 16px;
		}
		.rank-number {
			width: 26px;
			font-size: 20px;
		}
		.rank-avatar :global(.avatar) {
			width: 40px;
			height: 40px;
			font-size: 14px;
		}
		.rank-identity > strong {
			font-size: 15px;
		}
		.rank-identity small {
			font-size: 12px;
		}
		.rank-balance strong {
			font-size: 16px;
		}
		.rank-balance small {
			font-size: 11px;
		}
		.rank-row :global(.rank-chevron) {
			display: block;
		}
		.court-rules {
			margin: 25px 30px 0;
		}
	}
	@media (max-width: 359px) {
		.royal-topline {
			padding-inline: 12px;
		}
		.effects-button span {
			display: none;
		}
		.court-register {
			padding-inline: 11px;
		}
		.rank-row {
			gap: 6px;
		}
		.rank-avatar :global(.avatar) {
			width: 27px;
			height: 27px;
			font-size: 10px;
		}
		.rank-balance strong {
			font-size: 11px;
		}
		.rank-identity > strong {
			font-size: 11px;
		}
		.court-census > div {
			gap: 4px;
		}
		.court-census span {
			font-size: 9px;
		}
	}
	@media (prefers-reduced-motion: reduce) {
		.palace-dust i,
		.torch-flames {
			animation: none;
		}
		.rank-row {
			transition: none;
		}
	}
</style>
