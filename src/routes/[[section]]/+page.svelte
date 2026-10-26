<script lang="ts">
	import { onMount } from 'svelte';
	import { page } from '$app/state';
	import { goto } from '$app/navigation';
	import {
		LayoutDashboard,
		Wallet,
		ReceiptText,
		Utensils,
		Users,
		ArrowUpRight,
		Plus,
		RefreshCw,
		Sun,
		Moon,
		ChevronDown,
		CircleHelp,
		LoaderCircle,
		Menu,
		X,
		Check,
		AlertCircle,
		Settings2
	} from '@lucide/svelte';
	import { Button } from '$lib/components/ui/button';
	import Avatar from '$lib/components/Avatar.svelte';
	import Modal from '$lib/components/Modal.svelte';
	import Overview from '$lib/components/views/Overview.svelte';
	import BillComposer from '$lib/components/views/BillComposer.svelte';
	import Balances from '$lib/components/views/Balances.svelte';
	import Activity from '$lib/components/views/Activity.svelte';
	import Management from '$lib/components/views/Management.svelte';
	import DebtMatrix from '$lib/components/views/DebtMatrix.svelte';
	import { Switch } from '$lib/components/ui/switch';
	import { ApiError, fetchState, login, requestJson, sendCommand } from '$lib/client/api';
	import {
		initPreferences,
		isTestEnv,
		preferences,
		setTestView,
		setTheme
	} from '$lib/client/preferences.svelte';
	import type { AppState, Member } from '$lib/domain/types';
	let appState = $state<AppState | null>(null);
	let actor = $state('an');
	let loading = $state(true);
	let error = $state('');
	let busy = $state(false);
	let toast = $state('');
	let toastIsError = $state(false);
	let mobileMenu = $state(false);
	let releaseOpen = $state(false);
	let accountOpen = $state(false);
	let demoMembers = $state<Pick<Member, 'id' | 'name' | 'role' | 'color'>[]>([]);
	const navigation = [
		{ path: '/', label: 'Tổng quan', icon: LayoutDashboard },
		{ path: '/new-bill', label: 'Tạo hoá đơn', icon: Plus },
		{ path: '/balances', label: 'Số dư cá nhân', icon: Wallet },
		{ path: '/matrix', label: 'Ma trận nợ nần', icon: Users },
		{ path: '/activity', label: 'Ledger', icon: ReceiptText },
		{ path: '/members', label: 'Thành viên & quản lý', icon: Users }
	];
	const section = $derived(page.url.pathname);
	const currentMember = $derived(appState?.members.find((m) => m.id === actor));
	let toastTimer: ReturnType<typeof setTimeout>;
	function notify(message: string, isError = false) {
		clearTimeout(toastTimer);
		toast = message;
		toastIsError = isError;
		toastTimer = setTimeout(() => (toast = ''), 5500);
	}
	async function refresh() {
		let result;
		try {
			result = await fetchState();
		} catch (error) {
			if (!(error instanceof ApiError) || error.status !== 401) throw error;
			await login(actor);
			result = await fetchState();
		}
		appState = result.state;
		actor = result.actor;
		demoMembers = appState.members.filter((m) => m.active);
	}
	async function initialize() {
		loading = true;
		error = '';
		try {
			demoMembers = (await requestJson('/api/demo')).members;
			const saved = localStorage.getItem('lunchroom-actor') || 'an';
			actor = demoMembers.some((m) => m.id === saved) ? saved : demoMembers[0].id;
			await login(actor);
			await refresh();
		} catch (cause) {
			error = (cause as Error).message;
		} finally {
			loading = false;
		}
	}
	async function switchAccount(id: string) {
		busy = true;
		try {
			await login(id);
			await refresh();
			localStorage.setItem('lunchroom-actor', id);
			accountOpen = false;
			notify('Đã chuyển tài khoản thử nghiệm.');
		} catch (cause) {
			notify((cause as Error).message, true);
		} finally {
			busy = false;
		}
	}
	async function run(
		command: string,
		input: unknown,
		message = 'Đã lưu thay đổi.'
	): Promise<string | undefined> {
		busy = true;
		try {
			const response = await sendCommand(command, input);
			appState = response.state;
			if (message) notify(message);
			return response.result.reference || 'ok';
		} catch (cause) {
			notify((cause as Error).message, true);
			throw cause;
		} finally {
			busy = false;
		}
	}
	async function closeRelease() {
		try {
			await run('markReleaseSeen', {}, '');
			releaseOpen = false;
		} catch {
			/* The error toast stays visible. */
		}
	}
	onMount(() => {
		initPreferences();
		void initialize();
		const interval = setInterval(() => {
			if (appState && !busy) void refresh().catch(() => {});
		}, 15000);
		return () => {
			clearInterval(interval);
			clearTimeout(toastTimer);
		};
	});
</script>

<svelte:head
	><title>Chia tiền ăn</title><meta
		name="description"
		content="Quản lý hóa đơn, thanh toán và nợ nội bộ."
	/></svelte:head
>
<svelte:window
	onkeydown={(event) => {
		if (event.key === 'Escape') mobileMenu = false;
	}}
/>
<a class="skip-link" href="#main-content">Đến nội dung chính</a>
<div class="app-shell">
	{#if mobileMenu}<button
			class="mobile-backdrop"
			aria-label="Đóng trình đơn bên"
			onclick={() => (mobileMenu = false)}
		></button>{/if}
	<aside class:mobile-open={mobileMenu}>
		<a class="brand" href="/"
			><span class="brand-mark"><Utensils size={23} /></span><span>Chia tiền ăn</span></a
		>
		<button class="mobile-close icon-button" aria-label="Đóng trình đơn" onclick={() => (mobileMenu = false)}
			><X size={20} /></button
		>
		<div class="workspace">
			<span class="workspace-symbol">CTA</span>
			<div>
				<strong>Hội ăn trưa</strong><small
					>{appState?.members.filter((m) => m.active).length || '—'} thành viên · VND</small
				>
			</div>
			<ChevronDown size={14} />
		</div>
		<nav aria-label="Điều hướng chính">
			{#each navigation as item}
				<a
					href={item.path}
					class:active={section === item.path}
					aria-current={section === item.path ? 'page' : undefined}
					onclick={() => (mobileMenu = false)}
					><item.icon size={19} /><span>{item.label}</span>{#if item.path === '/activity' && appState}<span
							class="nav-count">{appState.ledger.length}</span
						>{/if}</a
				>
			{/each}
		</nav>
		<div class="sidebar-bottom">
			<button class="help-link" onclick={() => (releaseOpen = true)}
				><CircleHelp size={17} /> Changelog <ArrowUpRight size={15} /></button
			>
			{#if isTestEnv}<div class="env-toggle">
					<button type="button" tabindex="-1" onclick={() => setTestView(!preferences.testView)}
						><strong>Giao diện thử nghiệm</strong><small
							>{preferences.testView ? 'Đang xem bản thử nghiệm' : 'Đang xem như bản chính thức'}</small
						></button
					><Switch
						aria-label="Giao diện thử nghiệm"
						checked={preferences.testView}
						onCheckedChange={setTestView}
					/>
				</div>{/if}
			{#if preferences.testView}<div class="local-status">
					<span></span> Môi trường thử nghiệm cục bộ
				</div>{/if}
		</div>
	</aside>
	<div class="main-shell">
		<header class="topbar">
			<div class="breadcrumb">
				<button
					class="icon-button mobile-toggle"
					aria-label="Mở trình đơn"
					onclick={() => (mobileMenu = true)}><Menu size={21} /></button
				><span>Hội ăn trưa</span><span class="slash">/</span><strong
					>{section === '/new-bill'
						? 'Tạo hoá đơn'
						: navigation.find((n) => n.path === section)?.label || 'Không tìm thấy'}</strong
				>
			</div>
			<div class="topbar-actions">
				{#if preferences.testView}<span class="demo-badge"><span></span> Dữ liệu mẫu</span>{/if}<button
					class="icon-button theme-button"
					aria-label={preferences.theme === 'dark'
						? 'Chuyển sang giao diện sáng'
						: 'Chuyển sang giao diện tối'}
					onclick={() => setTheme(preferences.theme === 'dark' ? 'light' : 'dark')}
					>{#if preferences.theme === 'dark'}<Sun size={19} />{:else}<Moon size={19} />{/if}</button
				>
				<div class="topbar-divider"></div>
				<button
					class="account-button"
					onclick={() => (accountOpen = true)}
					aria-label={preferences.testView ? 'Chuyển tài khoản thử nghiệm' : 'Tài khoản'}
					><Avatar member={currentMember} size="small" /><span>{currentMember?.name || 'Đang kết nối'}</span
					><ChevronDown size={14} /></button
				>
			</div>
		</header>
		<main id="main-content">
			{#if loading}
				<div class="loading-panel">
					<h1>Đang tải dữ liệu…</h1>
					<LoaderCircle class="spin" size={22} />
				</div>
			{:else if error}
				<div class="loading-panel">
					<AlertCircle size={35} />
					<h1>Chưa kết nối được dữ liệu</h1>
					<p>{error}</p>
					<Button onclick={initialize}><RefreshCw size={16} /> Kết nối lại</Button>
				</div>
			{:else if appState && currentMember}
				{#if section === '/'}<Overview {appState} {actor} />
				{:else if section === '/new-bill'}{#key actor}<BillComposer {appState} {actor} {run} {busy} />{/key}
				{:else if section === '/balances'}{#key actor}<Balances {appState} {actor} {run} {busy} />{/key}
				{:else if section === '/activity'}<Activity {appState} {actor} {run} {busy} />
				{:else if section === '/members'}<Management {appState} {actor} {run} {busy} />
				{:else if section === '/matrix'}<DebtMatrix {appState} {actor} {run} {busy} />
				{:else}<div class="empty-state">
						<h1>Không tìm thấy trang</h1>
						<Button href="/">Về tổng quan</Button>
					</div>{/if}
			{/if}
		</main>
		<footer>
			<span>Chia tiền ăn</span><span>VND <span class="footer-dot">·</span> Giờ Việt Nam</span>
		</footer>
	</div>
</div>
{#if toast}<div class:error-toast={toastIsError} class="toast" role="status">
		{#if toastIsError}<AlertCircle size={19} />{:else}<Check size={19} />{/if}<span>{toast}</span><button
			aria-label="Đóng thông báo"
			onclick={() => (toast = '')}><X size={15} /></button
		>
	</div>{/if}
<Modal
	bind:open={accountOpen}
	title={preferences.testView ? 'Chọn tài khoản thử nghiệm' : 'Tài khoản'}
	description={preferences.testView ? 'Mỗi người có bản nháp riêng và quyền thao tác theo vai trò.' : ''}
>
	{#if preferences.testView}<div class="account-list">
			{#each demoMembers as member}<button
					class:chosen={actor === member.id}
					disabled={busy}
					onclick={() => switchAccount(member.id)}
					><Avatar {member} /><span
						><strong>{member.name}</strong><small
							>{member.role === 'admin' ? 'Quản trị viên' : 'Thành viên'}</small
						></span
					>{#if actor === member.id}<Check size={17} />{/if}</button
				>{/each}
		</div>
		<p class="fine-print">Tài khoản mẫu chỉ dùng trên bộ giả lập. Không cần mật khẩu thật.</p>
	{:else if currentMember}<div class="account-list">
			<div class="account-current">
				<Avatar member={currentMember} /><span
					><strong>{currentMember.name}</strong><small
						>{currentMember.email} · {currentMember.role === 'admin' ? 'Quản trị viên' : 'Thành viên'}</small
					></span
				>
			</div>
		</div>{/if}
</Modal>
<Modal bind:open={releaseOpen} title="Changelog" description="Chia tiền ăn · Phiên bản 0.2.0">
	<div class="release-note">
		<ul>
			<li>Giao diện tối và lịch chi tiêu theo ngày kèm âm lịch.</li>
			<li>Chia đều có làm tròn lên; nhập từng người hỗ trợ giá sau khi giảm giá.</li>
			<li>Tối giản nợ theo đúng thuật toán của bảng tính cũ.</li>
			{#if preferences.testView}<li>Email hoá đơn và QR chỉ mô phỏng trong môi trường thử nghiệm.</li>{/if}
		</ul>
	</div>
	<Button onclick={closeRelease} disabled={busy}>Đóng</Button>
</Modal>
