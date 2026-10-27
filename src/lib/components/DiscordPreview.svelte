<script lang="ts">
	import type { DiscordMessage } from '$lib/domain/notifications';
	import BillImage from './BillImage.svelte';
	let {
		message,
		groupId = '',
		imageId = ''
	}: { message: DiscordMessage; groupId?: string; imageId?: string } = $props();
	type Part = { kind: 'text' | 'strong' | 'link'; text: string; href?: string };
	function parts(value: string): Part[] {
		const result: Part[] = [];
		const pattern = /\\(.)|\*\*(.*?)\*\*|\[([^\]]+)\]\(<(https?:\/\/[^>]+)>\)/g;
		let cursor = 0;
		for (const match of value.matchAll(pattern)) {
			if (match.index! > cursor) result.push({ kind: 'text', text: value.slice(cursor, match.index) });
			if (match[1]) result.push({ kind: 'text', text: match[1] });
			else if (match[2]) result.push({ kind: 'strong', text: match[2].replace(/\\(.)/g, '$1') });
			else result.push({ kind: 'link', text: match[3], href: match[4] });
			cursor = match.index! + match[0].length;
		}
		if (cursor < value.length) result.push({ kind: 'text', text: value.slice(cursor) });
		return result;
	}
</script>

<div class="discord-preview" aria-label="Xem trước tin nhắn Discord">
	<div class="discord-preview-author"><span>CTA</span><strong>Chia tiền ăn</strong><small>APP</small></div>
	<div class="discord-preview-embeds">
		{#each message.embeds as embed}<section class="discord-preview-embed">
				{#if embed.title}<h3>{embed.title}</h3>{/if}
				{#if embed.image && imageId}<BillImage {groupId} {imageId} />{/if}
				{#if embed.description}{#each embed.description.split('\n') as line}
						{#if !line}<div class="discord-preview-space"></div>{:else}<p>
								{#each parts(line) as part}{#if part.kind === 'strong'}<strong>{part.text}</strong
										>{:else if part.kind === 'link'}<a
											href={part.href}
											target="_blank"
											rel="noopener noreferrer">{part.text}</a
										>{:else}{part.text}{/if}{/each}
							</p>{/if}
					{/each}{/if}
			</section>{/each}
	</div>
</div>
