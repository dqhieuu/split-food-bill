<script lang="ts">
	import { onMount } from 'svelte';
	import { Sparkles } from '@lucide/svelte';
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import { fetchAiSettings, sendCommand } from '$lib/client/api';
	import type { Group, GroupSummary } from '$lib/domain/types';
	import Modal from './Modal.svelte';
	let {
		open = $bindable(true),
		group,
		onUpdated,
		onSelect
	}: {
		open: boolean;
		group: GroupSummary;
		onUpdated: (group: Group) => void;
		onSelect: () => Promise<void>;
	} = $props();
	const groupId = $derived(group.id);
	const groupName = $derived(group.name);
	const isAdmin = $derived(group.role === 'admin');
	let busy = $state(false);
	let groupNameDraft = $state('');
	let aiLoading = $state(false);
	let aiSaved = $state({ endpoint: '', model: '' });
	let aiError = $state('');
	let aiEndpoint = $state('');
	let aiModel = $state('');
	let aiKey = $state('');
	let aiHasKey = $state(false);
	const aiComplete = $derived(!!aiEndpoint.trim() && !!aiModel.trim() && (!!aiKey.trim() || aiHasKey));
	async function run(command: string, input: unknown) {
		const response = await sendCommand(groupId, command, input);
		if (response.group) onUpdated(response.group);
	}
	onMount(() => {
		groupNameDraft = groupName;
		if (isAdmin) void openGroupConfig();
	});
	async function openGroupConfig() {
		aiLoading = true;
		aiError = '';
		aiKey = '';
		try {
			const settings = await fetchAiSettings(groupId);
			aiEndpoint = settings.endpoint;
			aiModel = settings.model;
			aiHasKey = settings.hasApiKey;
			aiSaved = { endpoint: settings.endpoint, model: settings.model };
		} catch (cause) {
			aiError = (cause as Error).message;
		} finally {
			aiLoading = false;
		}
	}
	/** Sends only the parts that changed, so saving a new name never touches the stored API key. */
	async function saveGroupConfig() {
		const name = groupNameDraft.trim();
		const renamed = !!name && name !== groupName;
		const aiChanged =
			aiEndpoint.trim() !== aiSaved.endpoint || aiModel.trim() !== aiSaved.model || !!aiKey.trim();
		busy = true;
		aiError = '';
		try {
			if (renamed) await run('renameGroup', { name });
			if (aiChanged)
				await run('saveAiSettings', {
					endpoint: aiEndpoint.trim(),
					model: aiModel.trim(),
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
			aiHasKey = false;
			aiSaved = { endpoint: '', model: '' };
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
		<label class="field">Máy chủ Discord<Input value={group.discordGuildId} readonly /></label>
		{#if isAdmin}<div class="group-config-section">
				<h3><Sparkles size={16} /> Đọc hóa đơn bằng AI</h3>
				<p class="fine-print">
					Dùng API tương thích OpenAI có hỗ trợ structured outputs và đọc ảnh. Nút AI chỉ hiện khi điền đủ cả
					ba mục.
				</p>
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
			<p class="fine-print">
				{aiComplete ? 'Thành viên sẽ thấy nút đọc hóa đơn bằng AI.' : 'Chưa đủ thông tin: nút AI sẽ bị ẩn.'}
			</p>
		{/if}
		<div class="modal-actions">
			<Button type="button" variant="outline" disabled={busy} onclick={onSelect}>Mở nhóm</Button>
			{#if isAdmin}
				{#if aiHasKey || aiSaved.endpoint || aiSaved.model}<Button
						type="button"
						variant="outline"
						disabled={busy || aiLoading}
						onclick={clearAiSettings}>Xóa cài đặt AI</Button
					>{/if}<Button type="submit" disabled={busy || aiLoading || !groupNameDraft.trim()}
					>{busy ? 'Đang lưu…' : 'Lưu cấu hình'}</Button
				>
			{/if}
		</div>
	</form></Modal
>
