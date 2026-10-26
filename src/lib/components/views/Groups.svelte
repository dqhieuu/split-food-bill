<script lang="ts">
	import { onMount } from 'svelte';
	import { Plus, Users } from '@lucide/svelte';
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import type { Session } from '$lib/domain/types';
	import { requestJson } from '$lib/client/api';
	let { session, onSelect }: { session: Session; onSelect: (id: string) => Promise<void> } = $props();
	let channels = $state<{ id: string; guildId: string; name: string }[]>([]);
	let preview = $state<{ id: string; name: string }[]>([]);
	let channelId = $state('');
	let name = $state('');
	let busy = $state(false);
	let error = $state('');
	onMount(() => {
		if (session.user.role === 'admin') void loadChannels();
	});
	async function loadChannels() {
		try {
			channels = (await requestJson('/api/discord/channels')).channels;
		} catch (cause) {
			error = (cause as Error).message;
		}
	}
	async function previewMembers() {
		error = '';
		preview = [];
		if (!channelId) return;
		try {
			preview = (await requestJson(`/api/discord/channels/${channelId}/members`)).members;
		} catch (cause) {
			error = (cause as Error).message;
		}
	}
	async function create() {
		busy = true;
		error = '';
		try {
			const { group } = await requestJson('/api/groups', {
				method: 'POST',
				body: JSON.stringify({ name, discordChannelId: channelId })
			});
			await onSelect(group.id);
		} catch (cause) {
			error = (cause as Error).message;
		} finally {
			busy = false;
		}
	}
</script>

<div class="page-heading"><h1>Nhóm</h1></div>
<div class="groups-layout">
	<section class="panel form-panel">
		<h2>Nhóm của bạn</h2>
		{#each session.groups as group}<button class="group-choice" onclick={() => onSelect(group.id)}
				><Users size={20} /><span
					><strong>{group.name}</strong><small
						>{group.role === 'admin' ? 'Quản trị viên nhóm' : 'Thành viên'} · {group.discordChannelId}</small
					></span
				></button
			>
		{:else}<p class="inline-empty">
				Bạn chưa được kích hoạt trong nhóm nào. Liên hệ quản trị viên nhóm.
			</p>{/each}
	</section>
	{#if session.user.role === 'admin'}<section class="panel form-panel">
			<h2>Tạo nhóm</h2>
			<label class="field">Tên nhóm<Input bind:value={name} maxlength={100} /></label>
			<label class="field"
				>Kênh Discord<select aria-label="Kênh Discord" bind:value={channelId} onchange={previewMembers}
					><option value="">Chọn kênh</option>{#each channels as channel}<option value={channel.id}
							>#{channel.name} · {channel.id}</option
						>{/each}</select
				></label
			>
			{#if preview.length}<p class="fine-print">
					{preview.length} người có quyền xem kênh. Thành viên mới sẽ ở trạng thái ngừng hoạt động; người tạo là
					quản trị viên nhóm.
				</p>{/if}
			<Button onclick={create} disabled={busy || !name.trim() || !channelId}
				><Plus size={17} /> Tạo nhóm</Button
			>
		</section>{/if}
</div>
{#if error}<p class="validation-error" role="alert">{error}</p>{/if}
