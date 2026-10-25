<script lang="ts">
	import { Inbox } from '@lucide/svelte';
	let { title = 'Chưa có dữ liệu', description = 'Các giao dịch mới sẽ xuất hiện tại đây.' } = $props();
</script>

<div class="empty-state">
	<Inbox size={30} />
	<h3>{title}</h3>
	<p>{description}</p>
</div>
