<script lang="ts">
	import {
		Users,
		Search,
		Plus,
		Pencil,
		Archive,
		Download,
		Upload,
		ShieldCheck,
		Check,
		ExternalLink,
		History,
		FileJson,
		CircleAlert,
		ChevronRight
	} from '@lucide/svelte';
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import { Switch } from '$lib/components/ui/switch';
	import Avatar from '../Avatar.svelte';
	import Modal from '../Modal.svelte';
	import type { AppState, Member } from '$lib/domain/types';
	import type { RunCommand } from '$lib/client/types';
	import { currency, dateTimeLabel, localDate, netBalance } from '$lib/domain/ledger';
	import { bankNames, resolveBank } from '$lib/domain/qr';
	import { banks } from '$lib/domain/banks';
	import { parseLedgerImport, summarizeImport, type ImportedEntry } from '$lib/domain/import';
	let {
		appState,
		actor,
		run,
		busy,
		groupId
	}: {
		appState: AppState;
		actor: string;
		run: RunCommand;
		busy: boolean;
		groupId: string;
	} = $props();
	let tab = $state('members');
	let search = $state('');
	let memberOpen = $state(false);
	let bankInput = $state('');
	let memberDraft = $state<Member>({
		id: '',
		name: '',
		active: true,
		role: 'member',
		bankCode: '970436',
		bankAccount: '',
		color: '#6c8b70'
	});
	let archiveOpen = $state(false);
	let archiveName = $state('');
	let archiveUrl = $state('');
	let validation = $state('');
	let importOpen = $state(false);
	let importEntries = $state<ImportedEntry[]>([]);
	let importError = $state('');
	let importProgress = $state('');
	let importing = $state(false);
	let acknowledged = $state(false);
	let activationChanges = $state<Record<string, boolean>>({});
	const isAdmin = $derived(appState.members.find((m) => m.id === actor)?.role === 'admin');
	const members = $derived(
		appState.members
			.filter((m) => `${m.id} ${m.name}`.toLocaleLowerCase('vi').includes(search.toLocaleLowerCase('vi')))
			.sort(
				(a, b) =>
					Number(b.id === actor) - Number(a.id === actor) ||
					Number(b.active) - Number(a.active) ||
					a.name.localeCompare(b.name, 'vi', { sensitivity: 'base' }) ||
					a.id.localeCompare(b.id)
			)
	);
	const summary = $derived(summarizeImport(importEntries, appState));
	const actionLabels: Record<string, string> = {
		recordPayments: 'Ghi hoàn tiền nhiều người',
		createBill: 'Ghi hóa đơn',
		recordPayment: 'Ghi hoàn tiền',
		confirmQrPayment: 'Ghi thanh toán QR',
		settleDebts: 'Tối giản nợ',
		saveMember: 'Cập nhật thành viên',
		retryBillNotification: 'Gửi lại thông báo Discord',
		saveArchive: 'Thêm lưu trữ',
		markReleaseSeen: 'Đã xem cập nhật',
		importLedger: 'Nhập lịch sử',
		syncDiscordMembers: 'Đồng bộ thành viên Discord',
		undoBill: 'Hoàn tác hóa đơn',
		renameGroup: 'Đổi tên nhóm',
		configureGroup: 'Cập nhật cấu hình nhóm',
		saveAiSettings: 'Cập nhật cài đặt AI'
	};
	function editMember(member: Member) {
		memberDraft = structuredClone($state.snapshot(member));
		bankInput = memberDraft.bankLabel ?? bankNames[memberDraft.bankCode] ?? memberDraft.bankCode;
		validation = '';
		memberOpen = true;
	}
	async function setMemberActive(member: Member, active: boolean) {
		if (!isAdmin || busy || member.id === actor || member.active === active) return;
		activationChanges[member.id] = active;
		try {
			await run(
				'saveMember',
				{ ...member, active },
				active ? `Đã kích hoạt ${member.name}.` : `Đã ngừng hoạt động ${member.name}.`
			);
		} catch {
			// The shared command handler displays errors; restore the saved switch state below.
		} finally {
			delete activationChanges[member.id];
		}
	}
	async function saveMember() {
		validation = '';
		if (!memberDraft.id || !memberDraft.name) {
			validation = 'Điền đầy đủ ID và tên.';
			return;
		}
		try {
			const bank = resolveBank(bankInput);
			await run(
				'saveMember',
				{ ...memberDraft, bankCode: bank.code, bankLabel: bank.label },
				'Đã lưu hồ sơ thành viên.'
			);
			memberOpen = false;
		} catch {}
	}
	async function saveArchive() {
		try {
			await run(
				'saveArchive',
				{ id: crypto.randomUUID(), name: archiveName, url: archiveUrl, date: localDate(new Date()) },
				'Đã thêm liên kết lưu trữ.'
			);
			archiveOpen = false;
		} catch {}
	}
	function downloadBackup() {
		const url = URL.createObjectURL(
			new Blob([JSON.stringify($state.snapshot(appState), null, 2)], { type: 'application/json' })
		);
		const anchor = document.createElement('a');
		anchor.href = url;
		anchor.download = `lunchroom-backup-${localDate(new Date())}.json`;
		anchor.click();
		URL.revokeObjectURL(url);
	}
	async function readImport(event: Event) {
		importError = '';
		importEntries = [];
		importProgress = '';
		acknowledged = false;
		const file = (event.currentTarget as HTMLInputElement).files?.[0];
		if (!file) return;
		if (file.size > 8_000_000) {
			importError = 'Tệp tối đa 8 MB.';
			return;
		}
		try {
			importEntries = parseLedgerImport(await file.text());
		} catch (error) {
			importError =
				error instanceof SyntaxError
					? 'Tệp JSON không hợp lệ.'
					: error instanceof Error && error.name !== 'ZodError'
						? error.message
						: 'Dữ liệu chưa hợp lệ. Kiểm tra cột, mã, loại và số tiền trong tệp.';
		}
	}
	async function commitImport() {
		if (summary.inactiveIds.length) return;
		importing = true;
		try {
			for (let offset = 0; offset < importEntries.length; offset += 150) {
				await run('importLedger', { entries: importEntries.slice(offset, offset + 150) }, '');
				importProgress = `Đã kiểm tra ${Math.min(offset + 150, importEntries.length)} / ${importEntries.length} dòng`;
			}
			importProgress += ' · Hoàn tất';
			importEntries = [];
			acknowledged = false;
		} catch {
			importError = 'Đã dừng nhập. Các lô trước vẫn được giữ; nhập lại cùng tệp sẽ bỏ qua dòng đã có.';
		} finally {
			importing = false;
		}
	}
</script>

<div class="page-heading">
	<div>
		<h1>Thành viên & quản lý</h1>
	</div>
</div>
<section class="panel">
	<div class="filter-toolbar">
		<div class="segmented-control">
			<button class:active={tab === 'members'} onclick={() => (tab = 'members')}>Thành viên</button><button
				class:active={tab === 'data'}
				onclick={() => (tab = 'data')}>Dữ liệu & lưu trữ</button
			><button class:active={tab === 'audit'} onclick={() => (tab = 'audit')}>Nhật ký thay đổi</button>
		</div>
		{#if isAdmin}<Button
				onclick={() => run('syncDiscordMembers', {}, 'Đã đồng bộ thành viên Discord.').catch(() => {})}
				disabled={busy}><Users size={17} /> Làm mới thành viên Discord</Button
			>{/if}
	</div>
	{#if tab === 'members'}<div class="management-search">
			<div class="search-field">
				<Search size={17} /><Input
					aria-label="Tìm thành viên"
					placeholder="Tìm ID hoặc tên…"
					bind:value={search}
				/>
			</div>
			<span class="fine-print"
				>{appState.members.filter((m) => m.active).length} / {appState.members.length} thành viên</span
			>
		</div>
		<div class="table-scroll">
			<table class="data-table">
				<thead
					><tr
						><th>Thành viên</th><th>Vai trò</th><th>Ngân hàng</th><th class="align-right">Lỗ/lãi</th><th
						></th></tr
					></thead
				><tbody
					>{#each members as member (member.id)}<tr class:inactive-member={!member.active}
							><td
								><div class="table-person">
									<Avatar {member} /><span><strong>{member.name}</strong></span>
								</div></td
							><td>{member.role === 'admin' ? 'Quản trị viên' : 'Thành viên'}</td><td
								>{member.bankLabel || bankNames[member.bankCode] || member.bankCode || 'Chưa thiết lập'}<small
									>{member.bankAccount
										? `•••• ${member.bankAccount.slice(-4)}`
										: 'Chưa có số tài khoản'}</small
								></td
							><td
								class="align-right"
								class:positive={netBalance(appState.ledger, member.id) >= 0}
								class:negative={netBalance(appState.ledger, member.id) < 0}
								>{currency(netBalance(appState.ledger, member.id))}</td
							><td
								><div class="member-row-actions">
									{#if isAdmin}<Switch
											aria-label={`Kích hoạt ${member.name}`}
											checked={activationChanges[member.id] ?? member.active}
											disabled={busy || member.id === actor}
											onCheckedChange={(active) => setMemberActive(member, active)}
										/>{/if}
									{#if isAdmin || member.id === actor}<Button
											variant="ghost"
											size="icon"
											aria-label={`Sửa hồ sơ ${member.name}`}
											onclick={() => editMember(member)}><Pencil size={16} /></Button
										>{/if}
								</div></td
							></tr
						>{/each}</tbody
				>
			</table>
		</div>
		{#if !members.length}<div class="inline-empty">Không tìm thấy thành viên.</div>{/if}
	{:else if tab === 'data'}<div class="management-data">
			<div class="two-panels">
				<div class="data-action-card">
					<FileJson size={25} />
					<h2>Sao lưu dữ liệu</h2>
					<p>Tải bản JSON gồm thành viên, hóa đơn, sổ giao dịch, thông báo và nhật ký.</p>
					{#if isAdmin}<Button variant="outline" onclick={downloadBackup}
							><Download size={16} /> Tải bản sao JSON</Button
						>{:else}<p class="fine-print">Chỉ quản trị viên được xuất bản sao đầy đủ.</p>{/if}
				</div>
				<div class="data-action-card">
					<Upload size={25} />
					<h2>Nhập sổ giao dịch cũ</h2>
					<p>
						Kiểm tra JSON hoặc CSV trước khi nhập. Giữ nguyên dòng 0 đồng, dòng tự nợ và tạo hồ sơ cũ nếu cần.
					</p>
					{#if isAdmin}<Button
							variant="outline"
							onclick={() => {
								importOpen = true;
								importError = '';
								importEntries = [];
								importProgress = '';
							}}><Upload size={16} /> Kiểm tra tệp nhập</Button
						>{:else}<p class="fine-print">Chỉ quản trị viên được nhập lịch sử.</p>{/if}
				</div>
			</div>
			<div class="panel-heading">
				<div>
					<h2>Liên kết lưu trữ</h2>
					<p>Tham chiếu sổ cũ, không tự nhập dữ liệu từ liên kết.</p>
				</div>
				{#if isAdmin}<Button
						variant="outline"
						onclick={() => {
							archiveName = '';
							archiveUrl = '';
							archiveOpen = true;
						}}><Plus size={16} /> Thêm liên kết</Button
					>{/if}
			</div>
			{#each appState.archives as archive}<a
					href={archive.url}
					target="_blank"
					rel="noopener noreferrer"
					class="archive-row"
					><Archive size={20} />
					<div><strong>{archive.name}</strong><small>{archive.url}</small></div>
					<ExternalLink size={16} /></a
				>{/each}{#if !appState.archives.length}<div class="inline-empty">
					Chưa có liên kết lưu trữ. Bạn có thể thêm sổ lịch sử của nhóm.
				</div>{/if}
			<div class="notice">
				<CircleAlert size={18} />
				<p>
					Bản sao chứa thông tin ngân hàng của nhóm. Các bản sao trên máy thuộc quyền quản lý của bạn. Tệp sao
					lưu có thể nhập lại phần sổ giao dịch; đây chưa phải công cụ khôi phục toàn bộ dữ liệu.
				</p>
			</div>
		</div>
	{:else}<div class="table-scroll">
			<table class="data-table">
				<thead><tr><th>Thời gian</th><th>Thành viên</th><th>Thao tác</th></tr></thead><tbody
					>{#each [...appState.audit].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 100) as event}<tr
							><td
								>{dateTimeLabel(event.date)}<small
									>{new Intl.DateTimeFormat('vi-VN', {
										hour: '2-digit',
										minute: '2-digit',
										timeZone: 'Asia/Ho_Chi_Minh'
									}).format(new Date(event.date))}</small
								></td
							><td>{appState.members.find((m) => m.id === event.actor)?.name || event.actor}</td><td
								>{actionLabels[event.action] || 'Cập nhật dữ liệu'}</td
							></tr
						>{/each}</tbody
				>
			</table>
		</div>
		{#if !appState.audit.length}<div class="inline-empty">
				Các thay đổi tiếp theo sẽ được ghi lại tại đây.
			</div>{/if}{/if}
</section>
<Modal
	bind:open={memberOpen}
	title="Chỉnh sửa hồ sơ"
	description="ID là định danh cố định. Thông tin ngân hàng dùng để tạo QR."
	wide
	><div class="form-two-columns">
		<label class="field">ID<Input bind:value={memberDraft.id} disabled={true} maxlength={100} /></label><label
			class="field"
			>Vai trò<select bind:value={memberDraft.role} disabled={!isAdmin || memberDraft.id === actor}
				><option value="member">Thành viên</option><option value="admin">Quản trị viên</option></select
			></label
		><label class="field">Tên<Input bind:value={memberDraft.name} maxlength={100} /></label><label
			class="field"
			>Ngân hàng<Input
				bind:value={bankInput}
				list="member-bank-options"
				placeholder="Nhập tên ngân hàng"
				autocomplete="off"
				maxlength={100}
			/>
			<datalist id="member-bank-options"
				>{#each banks as bank}<option value={bank.shortName} label={`${bank.name} (${bank.code})`}
					></option>{/each}</datalist
			></label
		><label class="field">Số tài khoản<Input bind:value={memberDraft.bankAccount} maxlength={40} /></label>
	</div>
	<div class="button-row">
		<label class="checkbox-label"
			><Switch
				bind:checked={memberDraft.active}
				disabled={!isAdmin || memberDraft.id === actor}
				aria-label="Thành viên đang hoạt động"
			/>Đang hoạt động</label
		>
	</div>
	{#if validation}<p class="validation-error">{validation}</p>{/if}<Button
		onclick={saveMember}
		disabled={busy}>Lưu hồ sơ</Button
	></Modal
>
<Modal
	bind:open={archiveOpen}
	title="Thêm liên kết lưu trữ"
	description="Giữ đường dẫn đến sổ lịch sử để cả nhóm tham khảo."
	><label class="field"
		>Tên lưu trữ<Input bind:value={archiveName} placeholder="Ví dụ: Sổ ăn trưa năm 2025" /></label
	><label class="field">Đường dẫn<Input type="url" bind:value={archiveUrl} placeholder="https://…" /></label
	><Button onclick={saveArchive} disabled={busy || !archiveName.trim() || !archiveUrl.trim()}
		>Lưu liên kết</Button
	></Modal
>
<Modal
	bind:open={importOpen}
	title="Kiểm tra và nhập sổ cũ"
	description="Nhập theo lô 150 dòng; mã giao dịch giúp tránh nhập trùng khi thử lại."
	wide
	><p class="fine-print">
		JSON: danh sách giao dịch hoặc bản sao của Chia tiền ăn. CSV dùng cột <code
			>id,from,to,type,amount,date,description,note,legacySequence</code
		>. Loại là <code>debt/payment</code> hoặc Nợ/Trả; tiền là số nguyên đồng; ngày ISO 8601 có múi giờ.
	</p>
	<Input
		type="file"
		accept=".json,.csv"
		onchange={readImport}
		disabled={importing}
		aria-label="Chọn tệp sổ giao dịch"
	/>{#if importError}<p class="validation-error" role="alert">
			{importError}
		</p>{/if}{#if importEntries.length}<div class="import-summary">
			<div><strong>{summary.total}</strong><span>Dòng trong tệp</span></div>
			<div><strong>{summary.newCount}</strong><span>Dòng mới</span></div>
			<div><strong>{summary.duplicates}</strong><span>Mã đã có</span></div>
		</div>
		<div class="notice">
			<ShieldCheck size={18} />
			<p>
				Giữ {summary.zeroCount} dòng 0 đồng và {summary.selfCount} dòng tự nợ.
				{#if summary.inactiveIds.length}
					Cần đồng bộ từ Discord trước khi nhập: {summary.inactiveIds.join(', ')}.
				{/if}
			</p>
		</div>
		<div class="table-scroll">
			<table class="data-table">
				<thead><tr><th>Người nợ / trả</th><th>Người nhận</th><th>Số tiền</th><th>Nội dung</th></tr></thead
				><tbody
					>{#each importEntries.slice(0, 5) as entry}<tr
							><td>{entry.from}</td><td>{entry.to}</td><td>{currency(entry.amount)}</td><td
								>{entry.description}</td
							></tr
						>{/each}</tbody
				>
			</table>
		</div>
		<label class="checkbox-label"
			><input type="checkbox" bind:checked={acknowledged} disabled={importing} />Tôi đã kiểm tra dữ liệu và
			muốn nhập vào nhóm này.</label
		><Button
			disabled={!acknowledged || busy || importing || !!summary.inactiveIds.length}
			onclick={commitImport}>{importing ? 'Đang nhập…' : 'Xác nhận nhập lịch sử'}</Button
		>{/if}{#if importProgress}<p class="positive" role="status">{importProgress}</p>{/if}</Modal
>
