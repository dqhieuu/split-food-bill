<script lang="ts">
	import { onMount, tick } from 'svelte';
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
		Camera,
		Crown
	} from '@lucide/svelte';
	import { Button } from '$lib/components/ui/button';
	import Avatar from '$lib/components/Avatar.svelte';
	import Modal from '$lib/components/Modal.svelte';
	import DatabaseReset from '$lib/components/DatabaseReset.svelte';
	import Overview from '$lib/components/views/Overview.svelte';
	import BillComposer from '$lib/components/views/BillComposer.svelte';
	import Balances from '$lib/components/views/Balances.svelte';
	import Activity from '$lib/components/views/Activity.svelte';
	import Management from '$lib/components/views/Management.svelte';
	import DebtMatrix from '$lib/components/views/DebtMatrix.svelte';
	import Leaderboard from '$lib/components/views/Leaderboard.svelte';
	import Groups from '$lib/components/views/Groups.svelte';
	import { Switch } from '$lib/components/ui/switch';
	import {
		ApiError,
		fetchState,
		initializeAuth,
		beginDiscordLogin,
		logout,
		getSession,
		selectGroup,
		saveDiscordNotificationPreference,
		sendCommand
	} from '$lib/client/api';
	import {
		initPreferences,
		isTestEnv,
		preferences,
		setTestView,
		setTheme
	} from '$lib/client/preferences.svelte';
	import type { AppState, Session, Group } from '$lib/domain/types';
	let appState = $state<AppState | null>(null);
	let sessionData = $state<Session | null>(null);
	let group = $state<Group | null>(null);
	let selectedGroupId = $state('');
	let actor = $state('');
	let loading = $state(true);
	let error = $state('');
	let busy = $state(false);
	let toast = $state('');
	let toastIsError = $state(false);
	let mobileMenu = $state(false);
	let releaseOpen = $state(false);
	let accountOpen = $state(false);
	let resetOpen = $state(false);
	let mainContent = $state<HTMLElement>();
	let mobilePageAnimation: Animation | undefined;
	let cameraInput = $state<HTMLInputElement>();
	let cameraContext: { groupId: string; actor: string } | null = null;
	let cameraBusy = $state(false);
	let billComposer = $state<{
		attachCapturedPhoto: (file: File) => Promise<void>;
		isProcessingImage: () => boolean;
	}>();
	const navigation = [
		{ path: '/overview', label: 'Tổng quan', icon: LayoutDashboard },
		{ path: '/new-bill', label: 'Tạo hoá đơn', icon: Plus },
		{ path: '/balances', label: 'Tài khoản của bạn', icon: Wallet },
		{ path: '/matrix', label: 'Ma trận nợ nần', icon: Users },
		{ path: '/leaderboard', label: 'Bảng xếp hạng', icon: Crown },
		{ path: '/activity', label: 'Ledger', icon: ReceiptText },
		{ path: '/members', label: 'Thành viên & quản lý', icon: Users },
		{ path: '/groups', label: 'Nhóm', icon: Users }
	];
	const bottomNavigation = [
		{ path: '/balances', lines: ['Tài khoản', 'của bạn'] },
		{ path: '/new-bill', lines: ['Tạo', 'hoá đơn'] },
		{ path: '/overview', lines: ['Tổng', 'quan'] },
		{ path: '/matrix', lines: ['Ma trận', 'nợ nần'] }
	].map(({ path, lines }) => ({ ...navigation.find((item) => item.path === path)!, lines }));
	const section = $derived(page.url.pathname === '/' ? '/balances' : page.url.pathname);
	const currentMember = $derived(appState?.members.find((member) => member.id === actor));
	const canCaptureBill = $derived(
		!!sessionData && !!appState && !!currentMember?.active && !loading && !error
	);
	const accountMember = $derived(sessionData?.user ?? currentMember);
	/** First letters of up to two words, e.g. "Hội ăn trưa" → "HĂ". */
	const groupInitials = $derived(
		(group?.name ?? '')
			.split(/\s+/)
			.filter(Boolean)
			.slice(0, 2)
			.map((word) => Array.from(word)[0])
			.join('')
			.toLocaleUpperCase('vi') || '?'
	);
	let toastTimer: ReturnType<typeof setTimeout>;
	async function navigateFromBottomBar(event: MouseEvent, path: string) {
		mobileMenu = false;
		if (
			event.button !== 0 ||
			event.metaKey ||
			event.ctrlKey ||
			event.shiftKey ||
			event.altKey ||
			section === path
		)
			return;
		event.preventDefault();
		mobilePageAnimation?.cancel();
		await goto(path, { replace: true });
		if (section !== path || !mainContent || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
		mobilePageAnimation = mainContent.animate(
			[
				{ opacity: 0, transform: 'translateY(10px)' },
				{ opacity: 1, transform: 'translateY(0)' }
			],
			{ duration: 200, easing: 'cubic-bezier(0.16, 1, 0.3, 1)' }
		);
	}
	/** Keeps the header and the group picker in step when an admin renames the group. */
	function applyGroup(next: Group) {
		if (group?.id === next.id) group = next;
		if (sessionData)
			sessionData = {
				...sessionData,
				groups: sessionData.groups.map((item) => (item.id === next.id ? { ...item, ...next } : item))
			};
	}
	function notify(message: string, isError = false) {
		clearTimeout(toastTimer);
		toast = message;
		toastIsError = isError;
		toastTimer = setTimeout(() => (toast = ''), 5500);
	}
	async function changeDiscordNotificationPreference(enabled: boolean) {
		const uid = sessionData?.user.id;
		const { preferences } = await saveDiscordNotificationPreference(enabled);
		if (sessionData && sessionData.user.id === uid)
			sessionData = {
				...sessionData,
				user: { ...sessionData.user, preferences: { ...sessionData.user.preferences, ...preferences } }
			};
	}
	function openBillCamera() {
		cameraContext = { groupId: selectedGroupId, actor };
		cameraInput?.click();
	}
	async function capturedBillPhoto(event: Event) {
		const input = event.currentTarget as HTMLInputElement;
		const file = input.files?.[0];
		input.value = '';
		const context = cameraContext;
		cameraContext = null;
		if (
			!file ||
			!context ||
			!canCaptureBill ||
			context.groupId !== selectedGroupId ||
			context.actor !== actor
		)
			return;
		cameraBusy = true;
		mobileMenu = false;
		try {
			await goto('/new-bill', { replace: true });
			await tick();
			if (context.groupId !== selectedGroupId || context.actor !== actor || !currentMember?.active) return;
			if (!billComposer) throw new Error('Không mở được hóa đơn. Vui lòng thử lại.');
			await billComposer.attachCapturedPhoto(file);
		} catch (cause) {
			notify((cause as Error).message || 'Không mở được hóa đơn. Vui lòng thử lại.', true);
		} finally {
			cameraBusy = false;
		}
	}
	async function changeGroup(id: string) {
		busy = true;
		error = '';
		try {
			sessionData = await getSession();
			await selectGroup(id);
			const result = await fetchState(id);
			selectedGroupId = id;
			appState = result.state;
			actor = result.actor;
			group = result.group;
		} catch (cause) {
			error = (cause as Error).message;
			appState = null;
		} finally {
			busy = false;
		}
	}
	async function restoreSession() {
		sessionData = await getSession();
		actor = sessionData.user.id;
		const requestedGroup = page.url.searchParams.get('group');
		if (requestedGroup && !sessionData.groups.some((item) => item.id === requestedGroup))
			throw new Error('Bạn chưa được kích hoạt trong nhóm của liên kết này.');
		const initialGroup = requestedGroup || sessionData.selectedGroupId;
		if (initialGroup) await changeGroup(initialGroup);
		else {
			selectedGroupId = '';
			appState = null;
			group = null;
		}
	}
	async function refresh() {
		if (!selectedGroupId) return;
		try {
			// Notification deliveries update receipts without bumping the ledger version.
			const delivering = appState?.receipts.some((receipt) => ['queued', 'sending'].includes(receipt.status));
			const result = await fetchState(selectedGroupId, delivering ? undefined : appState?.version);
			applyGroup(result.group);
			if ('unchanged' in result) return;
			appState = result.state;
		} catch (cause) {
			if (cause instanceof ApiError && cause.status === 401) await signOutUser();
			else if (cause instanceof ApiError && cause.status === 403) {
				appState = null;
				await restoreSession();
			} else throw cause;
		}
	}
	async function initialize() {
		loading = true;
		error = '';
		try {
			const auth = await initializeAuth();
			if (auth.uid) actor = auth.uid;
			if (auth.signedIn) await restoreSession();
		} catch (cause) {
			error = (cause as Error).message;
		} finally {
			loading = false;
		}
	}
	async function signOutUser() {
		await logout();
		sessionData = null;
		appState = null;
		group = null;
		selectedGroupId = '';
		actor = '';
		accountOpen = false;
	}
	async function run(
		command: string,
		input: unknown,
		message = 'Đã lưu thay đổi.'
	): Promise<string | undefined> {
		busy = true;
		try {
			const response = await sendCommand(selectedGroupId, command, input);
			appState = response.state;
			if (response.group) applyGroup(response.group);
			if (message) notify(message);
			return response.result.reference || 'ok';
		} catch (cause) {
			notify((cause as Error).message, true);
			if (cause instanceof ApiError && [401, 403].includes(cause.status)) void refresh();
			throw cause;
		} finally {
			busy = false;
		}
	}
	onMount(() => {
		initPreferences();
		void initialize();
		const poll = () => {
			if (appState && !busy && document.visibilityState === 'visible') void refresh().catch(() => {});
		};
		const interval = setInterval(poll, 15000);
		document.addEventListener('visibilitychange', poll);
		return () => {
			mobilePageAnimation?.cancel();
			clearInterval(interval);
			document.removeEventListener('visibilitychange', poll);
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
{#if !loading && !sessionData}
	<div class="auth-page">
		<span class="brand-mark"><Utensils size={28} /></span>
		<h1>Chia tiền ăn</h1>
		<Button onclick={beginDiscordLogin}>Đăng nhập bằng Discord</Button>{#if error}<p
				class="validation-error"
				role="alert"
			>
				{error}
			</p>
			<Button variant="outline" onclick={initialize}>Kết nối lại</Button>{/if}
	</div>
{:else}<a class="skip-link" href="#main-content">Đến nội dung chính</a>
	<div class="app-shell" class:has-mobile-camera={canCaptureBill}>
		{#if mobileMenu}<button
				class="mobile-backdrop"
				aria-label="Đóng trình đơn bên"
				onclick={() => (mobileMenu = false)}
			></button>{/if}
		<aside class:mobile-open={mobileMenu}>
			<a class="brand" href="/overview" onclick={() => (mobileMenu = false)}
				><span class="brand-mark"><Utensils size={23} /></span><span>Chia tiền ăn</span></a
			>
			<button
				class="mobile-close icon-button"
				aria-label="Đóng trình đơn"
				onclick={() => (mobileMenu = false)}><X size={20} /></button
			>
			<div class="workspace group-selector">
				<span class="workspace-symbol" aria-hidden="true">{groupInitials}</span>
				<strong class="workspace-label" aria-hidden="true">{group?.name || 'Chọn nhóm'}</strong>
				<ChevronDown size={17} aria-hidden="true" />
				<select
					aria-label="Nhóm hiện tại"
					value={selectedGroupId}
					disabled={busy || !sessionData?.groups.length}
					onchange={async (event) => {
						if (event.currentTarget.value) await changeGroup(event.currentTarget.value);
					}}
				>
					{#each sessionData?.groups ?? [] as item}<option value={item.id}>{item.name}</option>{/each}
				</select>
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
					><span>{group?.name || 'Chọn nhóm'}</span><span class="slash">/</span><strong
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
					<button class="account-button" onclick={() => (accountOpen = true)} aria-label="Tài khoản"
						><Avatar member={accountMember} size="small" /><span>{accountMember?.name || 'Đang kết nối'}</span
						><ChevronDown size={14} /></button
					>
				</div>
			</header>
			<main id="main-content" bind:this={mainContent}>
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
				{:else if sessionData && (section === '/groups' || !appState)}
					<Groups
						session={sessionData}
						onReset={() => (resetOpen = true)}
						onUpdated={applyGroup}
						onSelect={async (id) => {
							await changeGroup(id);
							if (!error) await goto('/', { replace: true });
						}}
					/>
				{:else if appState && currentMember}
					{#key selectedGroupId + actor}
						{#if section === '/overview'}<Overview
								{appState}
								{actor}
								{run}
								{busy}
								groupId={selectedGroupId}
							/>
						{:else if section === '/new-bill'}{#key actor}<BillComposer
									bind:this={billComposer}
									{appState}
									{actor}
									{run}
									{busy}
									groupId={selectedGroupId}
									aiEnabled={!!group?.aiEnabled}
									groupName={group?.name ?? ''}
									discordNotificationPreference={sessionData?.user.preferences?.discordBillNotifications ??
										true}
									onDiscordNotificationPreferenceChange={changeDiscordNotificationPreference}
								/>{/key}
						{:else if section === '/balances'}{#key actor}<Balances
									{appState}
									{actor}
									{run}
									{busy}
									groupId={selectedGroupId}
								/>{/key}
						{:else if section === '/activity'}<Activity
								{appState}
								{actor}
								{run}
								{busy}
								groupId={selectedGroupId}
							/>
						{:else if section === '/members'}<Management
								{appState}
								{actor}
								{run}
								{busy}
								groupId={selectedGroupId}
							/>
						{:else if section === '/matrix'}<DebtMatrix {appState} {actor} {run} {busy} />
						{:else if section === '/leaderboard'}<Leaderboard
								{appState}
								{actor}
								groupName={group?.name ?? ''}
							/>
						{:else}<div class="empty-state">
								<h1>Không tìm thấy trang</h1>
								<Button href="/overview">Về tổng quan</Button>
							</div>{/if}
					{/key}
				{/if}
			</main>
			<footer>
				<span>100% prompt bởi Yoasobi Fangei Club</span>
			</footer>
		</div>
	</div>
	{#if canCaptureBill}
		<input
			bind:this={cameraInput}
			type="file"
			accept="image/*"
			capture="environment"
			hidden
			aria-label="Chụp ảnh hóa đơn bằng camera"
			onchange={capturedBillPhoto}
			oncancel={() => (cameraContext = null)}
		/>
		<div class="mobile-camera-bar">
			<nav class="mobile-bottom-navigation" aria-label="Điều hướng nhanh">
				{#each bottomNavigation as item, index}
					{#if index === 2}<span aria-hidden="true"></span>{/if}
					<a
						class="mobile-bottom-link"
						class:active={section === item.path}
						href={item.path}
						aria-label={item.label}
						aria-current={section === item.path ? 'page' : undefined}
						onclick={(event) => void navigateFromBottomBar(event, item.path)}
						><item.icon size={20} aria-hidden="true" /><span class="mobile-bottom-label"
							>{#each item.lines as line}<span>{line}</span>{/each}</span
						></a
					>
				{/each}
			</nav>
			<button
				type="button"
				class="mobile-bill-camera"
				aria-label="Chụp ảnh hóa đơn"
				title="Chụp ảnh hóa đơn"
				aria-busy={cameraBusy}
				disabled={busy || cameraBusy || (section === '/new-bill' && !!billComposer?.isProcessingImage())}
				onclick={openBillCamera}
			>
				{#if cameraBusy}<LoaderCircle class="spin" size={26} />{:else}<Camera size={26} />{/if}
			</button>
		</div>
	{/if}
	{#if toast}<div
			class:error-toast={toastIsError}
			class:camera-toast-offset={canCaptureBill}
			class="toast"
			role="status"
		>
			{#if toastIsError}<AlertCircle size={19} />{:else}<Check size={19} />{/if}<span>{toast}</span><button
				aria-label="Đóng thông báo"
				onclick={() => (toast = '')}><X size={15} /></button
			>
		</div>{/if}
	<Modal bind:open={accountOpen} title="Tài khoản">
		{#if sessionData}<div class="account-current">
				<Avatar member={sessionData.user} />
				<div>
					<strong>{sessionData.user.name}</strong><small
						>{sessionData.user.role === 'admin' ? 'Quản trị viên hệ thống' : 'Thành viên hệ thống'}</small
					>
				</div>
			</div>{/if}
		<Button onclick={signOutUser}>Đăng xuất</Button>
	</Modal><Modal bind:open={releaseOpen} title="Changelog" description="Chia tiền ăn · Phiên bản 0.2.0">
		<div class="release-note">
			<ul>
				<li>Giao diện tối và lịch chi tiêu theo ngày kèm âm lịch.</li>
				<li>Chia đều có làm tròn lên; nhập từng người hỗ trợ giá sau khi giảm giá.</li>
				<li>Tối giản nợ theo đúng thuật toán của bảng tính cũ.</li>
				{#if preferences.testView}<li>Thông báo Discord được mô phỏng trong môi trường cục bộ.</li>{/if}
			</ul>
		</div>
		<Button onclick={() => (releaseOpen = false)}>Đóng</Button>
	</Modal>
{/if}
<DatabaseReset
	bind:open={resetOpen}
	{actor}
	onComplete={async () => {
		error = '';
		await signOutUser();
	}}
/>
