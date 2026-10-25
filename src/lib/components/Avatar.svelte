<script lang="ts">
	import type { Member } from '$lib/domain/types';
	let {
		member,
		size = 'normal'
	}: { member?: Pick<Member, 'name' | 'color'>; size?: 'small' | 'normal' | 'large' } = $props();
</script>

<span class="avatar {size}" style:--avatar-color={member?.color || '#7f8a77'} aria-hidden="true"
	>{member?.name
		.split(' ')
		.slice(-2)
		.map((n) => n[0])
		.join('') || '?'}</span
>
