<script lang="ts">
	import { untrack } from 'svelte';
	import Modal from './Modal.svelte';
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import { Switch } from '$lib/components/ui/switch';
	import { bankNames, resolveBank } from '$lib/domain/qr';
	import { banks } from '$lib/domain/banks';
	import type { Member } from '$lib/domain/types';
	import type { RunCommand } from '$lib/client/types';

	let {
		open = $bindable(false),
		member,
		actor,
		canManageRoles = false,
		run,
		busy,
		title = 'Chỉnh sửa hồ sơ',
		description = 'ID là định danh cố định. Thông tin ngân hàng dùng để tạo QR.'
	}: {
		open: boolean;
		member?: Member;
		actor: string;
		canManageRoles?: boolean;
		run: RunCommand;
		busy: boolean;
		title?: string;
		description?: string;
	} = $props();
	const uid = $props.id();
	const memberId = $derived(member?.id ?? '');
	let draft = $state<Member>({
		id: '',
		name: '',
		active: true,
		role: 'member',
		bankCode: '',
		bankAccount: '',
		color: '#6c8b70'
	});
	let bankInput = $state('');
	let validation = $state('');
	$effect(() => {
		if (open && memberId)
			untrack(() => {
				draft = structuredClone($state.snapshot(member!));
				bankInput = draft.bankLabel ?? bankNames[draft.bankCode] ?? draft.bankCode;
				validation = '';
			});
	});
	async function save() {
		if (busy || !member) return;
		validation = '';
		if (!draft.id || !draft.name.trim()) {
			validation = 'Điền đầy đủ ID và tên.';
			return;
		}
		try {
			const bank = resolveBank(bankInput);
			await run(
				'saveMember',
				{ ...draft, bankCode: bank.code, bankLabel: bank.label },
				'Đã lưu hồ sơ thành viên.'
			);
			open = false;
		} catch {
			/* Keep edits available if saving fails. */
		}
	}
</script>

<Modal bind:open {title} {description} wide>
	<div class="form-two-columns">
		<label class="field">ID<Input value={draft.id} disabled maxlength={100} /></label>
		<label class="field"
			>Vai trò<select
				aria-label="Vai trò"
				bind:value={draft.role}
				disabled={busy || !canManageRoles || draft.id === actor}
				><option value="member">Thành viên</option><option value="admin">Quản trị viên</option></select
			></label
		>
		<label class="field">Tên<Input bind:value={draft.name} disabled={busy} maxlength={100} /></label>
		<label class="field"
			>Ngân hàng<Input
				bind:value={bankInput}
				disabled={busy}
				list={`${uid}-banks`}
				placeholder="Nhập tên ngân hàng"
				autocomplete="off"
				maxlength={100}
			/><datalist id={`${uid}-banks`}
				>{#each banks as bank}<option value={bank.shortName} label={`${bank.name} (${bank.code})`}
					></option>{/each}</datalist
			></label
		>
		<label class="field"
			>Số tài khoản<Input bind:value={draft.bankAccount} disabled={busy} maxlength={40} /></label
		>
	</div>
	<div class="button-row">
		<label class="checkbox-label"
			><Switch
				bind:checked={draft.active}
				disabled={busy || !canManageRoles || draft.id === actor}
				aria-label="Thành viên đang hoạt động"
			/>Đang hoạt động</label
		>
	</div>
	{#if validation}<p class="validation-error" role="alert">{validation}</p>{/if}
	<Button onclick={save} disabled={busy || !member}>Lưu hồ sơ</Button>
</Modal>
