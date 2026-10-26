<script lang="ts">
	import { onMount } from 'svelte';
	import { Plus, Users, RefreshCw, Trash2 } from '@lucide/svelte';
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import type { Session } from '$lib/domain/types';
	import { requestJson } from '$lib/client/api';
	let {
		session,
		onSelect,
		onReset
	}: { session: Session; onSelect: (id: string) => Promise<void>; onReset: () => void } = $props();
	let guilds = $state<{ id: string; name: string }[]>([]);
	let preview = $state<{ id: string; name: string }[]>([]);
	let guildId = $state('');
	let name = $state('');
	let busy = $state(false);
	let error = $state('');
	let refreshing = $state(false);
	onMount(() => {
		if (session.user.role === 'admin') void loadGuilds();
	});
	async function loadGuilds() {
		try {
			guilds = (await requestJson('/api/discord/guilds')).guilds;
		} catch (cause) {
			error = (cause as Error).message;
		}
	}
	async function previewMembers(refresh = false) {
		error = '';
		preview = [];
		if (!guildId) return;
		refreshing = true;
		try {
			preview = (await requestJson(`/api/discord/guilds/${guildId}/members${refresh ? '?refresh=true' : ''}`))
				.members;
		} catch (cause) {
			error = (cause as Error).message;
		} finally {
			refreshing = false;
		}
	}
	async function create() {
		busy = true;
		error = '';
		try {
			const { group } = await requestJson('/api/groups', {
				method: 'POST',
				body: JSON.stringify({ name, discordGuildId: guildId })
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
						>{group.role === 'admin' ? 'Quản trị viên nhóm' : 'Thành viên'} · {group.discordGuildId}</small
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
				>Máy chủ Discord<select
					aria-label="Máy chủ Discord"
					bind:value={guildId}
					onchange={() => previewMembers()}
					disabled={busy || refreshing}
					><option value="">Chọn máy chủ</option>{#each guilds as guild}<option value={guild.id}
							>{guild.name} · {guild.id}</option
						>{/each}</select
				></label
			>
			<Button variant="outline" disabled={!guildId || refreshing || busy} onclick={() => previewMembers(true)}
				><RefreshCw size={16} />Làm mới danh sách Discord</Button
			>
			{#if preview.length}<p class="fine-print">
					{preview.length} thành viên trong máy chủ. Thành viên mới sẽ ở trạng thái ngừng hoạt động; người tạo là
					quản trị viên nhóm.
				</p>{/if}
			<Button onclick={create} disabled={busy || refreshing || !name.trim() || !guildId}
				><Plus size={17} /> Tạo nhóm</Button
			>
		</section>{/if}
</div>
{#if session.user.role === 'admin'}<div class="system-reset-action">
		<Button variant="destructive" onclick={onReset}><Trash2 size={16} />Xóa toàn bộ cơ sở dữ liệu</Button>
	</div>{/if}
{#if error}<p class="validation-error" role="alert">{error}</p>{/if}
