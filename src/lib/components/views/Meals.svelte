<script lang="ts">
	import { Leaf, Shuffle, Save, Utensils, Pencil, CalendarDays, Check } from '@lucide/svelte';
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import type { AppState, Meal } from '$lib/domain/types';
	import type { RunCommand } from '$lib/client/types';
	import { localDate, dateLabel } from '$lib/domain/ledger';
	let { appState, run, busy }: { appState: AppState; run: RunCommand; busy: boolean } = $props();
	let editing = $state(false);
	let draft = $state<Meal[]>([]);
	let validation = $state('');
	const dishes = [
		'Bún riêu cua',
		'Cơm cá kho tộ',
		'Bún đậu mắm tôm',
		'Bánh cuốn nóng',
		'Hủ tiếu Nam Vang',
		'Cơm gà xối mỡ',
		'Miến gà',
		'Bún chả Hà Nội',
		'Phở bò',
		'Mì Quảng',
		'Bún bò Huế',
		'Cơm tấm sườn bì',
		'Cơm chay nấm',
		'Bún thịt nướng',
		'Bánh canh cua'
	];
	function edit() {
		draft = structuredClone($state.snapshot(appState.meals));
		editing = true;
		validation = '';
	}
	function suggest() {
		const recent = appState.ledger
			.filter((e) => e.type === 'debt' && e.source !== 'settlement')
			.sort((a, b) => b.date.localeCompare(a.date))
			.slice(0, 40)
			.map((e) => e.description.toLocaleLowerCase('vi'));
		const candidates = dishes.filter((d) => !recent.some((r) => r.includes(d.toLocaleLowerCase('vi'))));
		const shuffle = (items: string[]) => {
			const result = [...items];
			for (let i = result.length - 1; i > 0; i--) {
				const j = Math.floor(Math.random() * (i + 1));
				[result[i], result[j]] = [result[j], result[i]];
			}
			return result;
		};
		const pool = [...shuffle(candidates), ...shuffle(dishes.filter((d) => !candidates.includes(d)))];
		const monday = new Date();
		monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7));
		draft = appState.meals.map((m, i) => {
			const date = new Date(monday);
			date.setDate(date.getDate() + i);
			return { ...m, dish: pool[i], date: localDate(date), note: 'Gợi ý đổi vị, tránh trùng món trong tuần' };
		});
		editing = true;
	}
	async function save() {
		if (draft.some((m) => !m.dish.trim())) {
			validation = 'Mỗi ngày cần có một món ăn.';
			return;
		}
		try {
			await run('saveMeals', draft, 'Đã lưu thực đơn chung của tuần.');
			editing = false;
		} catch {}
	}
</script>

<div class="page-heading">
	<div>
		<div class="eyebrow">THÊM MỘT CHÚT CẢM HỨNG</div>
		<h1>Tuần này ăn gì? <Leaf size={28} class="inline-leaf" /></h1>
		<p>Năm ngày, năm bữa ngon. Bớt một câu hỏi khó cho cả đội.</p>
	</div>
	<div class="button-row">
		<Button variant="outline" onclick={suggest} disabled={busy}><Shuffle size={16} /> Gợi ý thực đơn</Button
		>{#if editing}<Button onclick={save} disabled={busy}><Save size={16} /> Lưu thực đơn</Button
			>{:else}<Button onclick={edit}><Pencil size={16} /> Chỉnh sửa</Button>{/if}
	</div>
</div>
<div class="notice">
	<Leaf size={18} />
	<p>
		Gợi ý từ danh sách món Việt, có tham khảo món gần đây và không lặp trong cùng tuần. Chưa kết nối dịch vụ
		AI; bạn có thể sửa mọi món.
	</p>
</div>
{#if validation}<p class="validation-error">{validation}</p>{/if}
<div class="meal-week">
	{#each editing ? draft : appState.meals as meal, i}<section
			class="meal-day-card"
			class:current={meal.date === localDate(new Date())}
		>
			<div class="meal-day-header">
				<span>{meal.day}</span><small>{dateLabel(meal.date + 'T12:00:00+07:00').slice(0, 5)}</small
				>{#if meal.date === localDate(new Date())}<span class="mini-pill">Hôm nay</span>{/if}
			</div>
			<div class="meal-day-art art-{i}" aria-hidden="true">
				<div class="bowl"><span></span><i></i><b></b></div>
				<div class="bowl-shadow"></div>
				<span class="meal-art-leaf"><Leaf size={25} /></span>
			</div>
			<div class="meal-day-content">
				<span class="small-caps">BỮA TRƯA {String(i + 1).padStart(2, '0')}</span>{#if editing}<label
						class="field"
						>Món ăn<Input
							bind:value={draft[i].dish}
							aria-label={`Món ăn ${meal.day}`}
							maxlength={300}
						/></label
					><label class="field"
						>Ghi chú<Input
							bind:value={draft[i].note}
							aria-label={`Ghi chú ${meal.day}`}
							maxlength={300}
						/></label
					><label class="field">Ngày<Input type="date" bind:value={draft[i].date} /></label>{:else}<h2>
						{meal.dish}
					</h2>
					<p>{meal.note}</p>
					<a href={`/new-bill?meal=${encodeURIComponent(meal.dish)}`} class="text-link"
						>Ghi hóa đơn món này <Utensils size={14} /></a
					>{/if}
			</div>
		</section>{/each}
</div>
{#if editing}<div class="button-row">
		<Button variant="outline" onclick={() => (editing = false)}>Hủy chỉnh sửa</Button><span class="fine-print"
			>Thực đơn là không gian chung, mọi thành viên đều có thể góp ý.</span
		>
	</div>{/if}
<div class="meal-bottom-note">
	<Utensils size={23} />
	<h2>Cùng ăn một bữa, gần nhau một chút.</h2>
	<p>Không cần cầu kỳ. Chỉ cần một món ngon và đủ mặt cả đội.</p>
</div>
