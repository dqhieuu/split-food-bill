<script lang="ts">
	import { onMount } from 'svelte';
	import { Sparkles } from '@lucide/svelte';
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import { fetchAiSettings, requestJson } from '$lib/client/api';
	import type { ConfigureGroup } from '$lib/client/types';
	import type { GroupSummary } from '$lib/domain/types';
	import { REASONING_EFFORTS, type ReasoningEffort } from '$lib/domain/ai';
	import Modal from './Modal.svelte';
	let {
		open = $bindable(true),
		group,
		onConfigure
	}: {
		open: boolean;
		group: GroupSummary;
		onConfigure: ConfigureGroup;
	} = $props();
	const groupId = $derived(group.id);
	const groupName = $derived(group.name);
	const isAdmin = $derived(group.role === 'admin');
	let busy = $state(false);
	let groupNameDraft = $state('');
	let guildId = $state('');
	let guilds = $state<{ id: string; name: string }[]>([]);
	let guildsLoading = $state(false);
	let aiLoading = $state(false);
	let aiSaved = $state({ endpoint: '', model: '', reasoningEffort: '' as ReasoningEffort });
	let aiError = $state('');
	let aiEndpoint = $state('');
	let aiModel = $state('');
	let aiReasoningEffort = $state<ReasoningEffort>('');
	let aiKey = $state('');
	let aiHasKey = $state(false);
	async function run(command: string, input: unknown) {
		if (!isAdmin) throw new Error('Chỉ quản trị viên nhóm được cấu hình nhóm.');
		await onConfigure(groupId, command, input);
	}
	onMount(() => {
		groupNameDraft = groupName;
		guildId = group.discordGuildId;
		if (isAdmin) {
			void openGroupConfig();
			void loadGuilds();
		}
	});
	async function loadGuilds() {
		guildsLoading = true;
		try {
			guilds = (await requestJson(`/api/discord/guilds?groupId=${groupId}`)).guilds;
		} catch (cause) {
			aiError = (cause as Error).message;
		} finally {
			guildsLoading = false;
		}
	}
	async function openGroupConfig() {
		aiLoading = true;
		aiError = '';
		aiKey = '';
		try {
			const settings = await fetchAiSettings(groupId);
			aiEndpoint = settings.endpoint;
			aiModel = settings.model;
			aiReasoningEffort = settings.reasoningEffort ?? '';
			aiHasKey = settings.hasApiKey;
			aiSaved = { endpoint: settings.endpoint, model: settings.model, reasoningEffort: aiReasoningEffort };
		} catch (cause) {
			aiError = (cause as Error).message;
		} finally {
			aiLoading = false;
		}
	}
	/** Sends only the parts that changed, so saving a new name never touches the stored API key. */
	async function saveGroupConfig() {
		const name = groupNameDraft.trim();
		const changed = !!name && (name !== groupName || guildId !== group.discordGuildId);
		const aiChanged =
			aiEndpoint.trim() !== aiSaved.endpoint ||
			aiModel.trim() !== aiSaved.model ||
			aiReasoningEffort !== aiSaved.reasoningEffort ||
			!!aiKey.trim();
		busy = true;
		aiError = '';
		try {
			if (changed) await run('configureGroup', { name, discordGuildId: guildId });
			if (aiChanged)
				await run('saveAiSettings', {
					endpoint: aiEndpoint.trim(),
					model: aiModel.trim(),
					reasoningEffort: aiReasoningEffort,
					apiKey: aiKey.trim()
				});
			open = false;
		} catch (cause) {
			aiError = (cause as Error).message;
		} finally {
			busy = false;
		}
	}
	async function clearAiSettings() {
		busy = true;
		aiError = '';
		try {
			await run('saveAiSettings', { endpoint: '', model: '', clearApiKey: true });
			aiEndpoint = aiModel = aiKey = '';
			aiReasoningEffort = '';
			aiHasKey = false;
			aiSaved = { endpoint: '', model: '', reasoningEffort: '' };
		} catch (cause) {
			aiError = (cause as Error).message;
		} finally {
			busy = false;
		}
	}
</script>

<Modal
	bind:open
	title="Cấu hình nhóm"
	description="Tên nhóm hiển thị cho mọi thành viên và trong thông báo Discord."
	wide
	locked={busy}
	><form
		class="group-config-form"
		onsubmit={(event) => {
			event.preventDefault();
			void saveGroupConfig();
		}}
	>
		<label class="field"
			>Tên nhóm<Input bind:value={groupNameDraft} maxlength={100} required disabled={!isAdmin} /></label
		>
		<label class="field"
			>Máy chủ Discord<select
				aria-label="Máy chủ Discord"
				bind:value={guildId}
				disabled={busy || guildsLoading || !isAdmin}
			>
				{#if !guilds.some((guild) => guild.id === group.discordGuildId)}<option value={group.discordGuildId}
						>Máy chủ hiện tại</option
					>{/if}
				{#each guilds as guild}<option value={guild.id}>{guild.name}</option>{/each}
			</select></label
		>
		{#if isAdmin}<div class="group-config-section">
				<h3><Sparkles size={16} /> Đọc hóa đơn bằng AI</h3>
			</div>
			<label class="field"
				>Endpoint<Input
					bind:value={aiEndpoint}
					type="url"
					placeholder="https://api.openai.com/v1"
					maxlength={300}
					disabled={aiLoading}
				/></label
			>
			<label class="field"
				>Model<Input
					bind:value={aiModel}
					placeholder="gpt-4o-mini"
					maxlength={100}
					disabled={aiLoading}
				/></label
			>
			<label class="field"
				>Reasoning effort<select bind:value={aiReasoningEffort} disabled={aiLoading}>
					{#each REASONING_EFFORTS as effort}<option value={effort}>{effort || 'Mặc định của model'}</option
						>{/each}
				</select></label
			>
			<label class="field"
				>API key<Input
					bind:value={aiKey}
					type="password"
					autocomplete="off"
					placeholder={aiHasKey ? 'Đã lưu · để trống để giữ nguyên' : 'sk-…'}
					maxlength={500}
					disabled={aiLoading}
				/><small>API key chỉ lưu trên máy chủ và không hiển thị lại.</small></label
			>
			{#if aiError}<p class="validation-error" role="alert">{aiError}</p>{/if}
		{/if}
		<div class="modal-actions">
			{#if isAdmin}
				{#if aiHasKey || aiSaved.endpoint || aiSaved.model}<Button
						type="button"
						variant="outline"
						disabled={busy || aiLoading}
						onclick={clearAiSettings}>Xóa cài đặt AI</Button
					>{/if}<Button
					type="submit"
					disabled={!isAdmin || busy || aiLoading || guildsLoading || !groupNameDraft.trim() || !guildId}
					>{busy ? 'Đang lưu…' : 'Lưu cấu hình'}</Button
				>
			{/if}
		</div>
	</form></Modal
>
