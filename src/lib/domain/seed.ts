import type { AppState, Member } from './types';

export function createDemoState(now = new Date()): AppState {
	const profiles = [
		['an', 'Minh An', '#44735a'],
		['linh', 'Thảo Linh', '#c58a60'],
		['huy', 'Quang Huy', '#7b8eaf'],
		['mai', 'Ngọc Mai', '#b0788e'],
		['nam', 'Hoàng Nam', '#8e8e5d'],
		['vy', 'Tường Vy', '#8d7cac'],
		['khoa', 'Đăng Khoa', '#5e999c'],
		['chi', 'Bảo Chi', '#b78c50'],
		['former', 'Thành viên cũ', '#a8a29e']
	];
	const members: Member[] = profiles.map(([id, name, color], i) => ({
		id,
		name,
		color,
		email: `${id}@example.test`,
		active: id !== 'former',
		role: i === 0 ? 'admin' : 'member',
		bankCode: '970436',
		bankAccount: `00000000${i + 1}123`
	}));
	const state: AppState = {
		version: 1,
		members,
		ledger: [],
		bills: [],
		receipts: [],
		settlements: [],
		archives: [],
		audit: []
	};
	const descriptions = [
		'Cơm gà Hội An',
		'Bún bò Huế',
		'Bánh mì & cà phê',
		'Cơm tấm sườn bì',
		'Bún thịt nướng',
		'Mì Quảng',
		'Phở bò',
		'Bún chả Hà Nội'
	];
	for (let day = 20; day >= 0; day--) {
		const date = new Date(now);
		date.setDate(date.getDate() - day);
		date.setHours(12, 15, 0, 0);
		const organizer = ['an', 'linh', 'huy', 'mai'][day % 4];
		const participants = members.filter(
			(m) => m.active && (profiles.findIndex((p) => p[0] === m.id) + day) % 3 !== 0
		);
		const id = `demo-bill-${day}`;
		const lines = participants.map((m, i) => ({
			memberId: m.id,
			amount: 35000 + ((day + i) % 5) * 10000,
			description: descriptions[day % 8],
			note: i === 0 ? 'Ít cay' : ''
		}));
		state.bills.push({
			id,
			memberNames: Object.fromEntries(members.map((member) => [member.id, member.name])),
			organizer,
			description: descriptions[day % 8],
			date: date.toISOString(),
			lines,
			total: lines.reduce((s, l) => s + l.amount, 0),
			emailReceipt: true
		});
		lines.forEach((l, i) => {
			if (l.memberId !== organizer)
				state.ledger.push({
					id: `${id}-${i}`,
					from: l.memberId,
					to: organizer,
					type: 'debt',
					amount: l.amount,
					date: date.toISOString(),
					description: l.description,
					note: l.note,
					creator: organizer,
					source: 'bill',
					reference: id
				});
		});
		state.receipts.push({
			id,
			billId: id,
			status: day % 6 === 0 ? 'queued' : 'simulated',
			recipients: participants.map((m) => m.email),
			attempts: day % 6 === 0 ? 0 : 1,
			error: '',
			createdAt: date.toISOString()
		});
	}
	state.ledger.push({
		id: 'demo-former',
		from: 'former',
		to: 'an',
		type: 'debt',
		amount: 85000,
		date: new Date(now.getTime() - 30 * 86400000).toISOString(),
		description: 'Bữa trưa trước khi chuyển nhóm',
		note: 'Giữ nguyên nợ thành viên cũ',
		creator: 'an',
		source: 'import',
		reference: 'demo',
		legacySequence: '1'
	});
	state.ledger.push({
		id: 'demo-payment',
		from: 'an',
		to: 'huy',
		type: 'payment',
		amount: 100000,
		date: new Date(now.getTime() - 86400000).toISOString(),
		description: 'Chuyển khoản cuối tuần',
		note: 'Dữ liệu minh họa',
		creator: 'an',
		source: 'manual',
		reference: 'demo-payment'
	});
	for (const bill of state.bills) bill.createdAt = bill.date;
	for (const entry of state.ledger) entry.createdAt = entry.date;
	return state;
}
