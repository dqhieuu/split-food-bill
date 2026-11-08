import { applyCommand } from '$lib/domain/ledger';
import type { AppState } from '$lib/domain/types';

export const settlementScenarios = {
	first: { label: 'Tối giản lần đầu', member: 'huy' },
	repeat: { label: 'Tối giản lại khi chưa ai trả', member: 'huy' },
	newHub: { label: 'Thêm hóa đơn làm đổi nợ chúa', member: 'an' },
	partial: { label: 'Trả một phần rồi tối giản lại', member: 'huy' },
	undo: { label: 'Hoàn tác tối giản sau khi đã chuyển tiền', member: 'huy' }
} as const;

export type SettlementScenario = keyof typeof settlementScenarios;

export function settlementFixture(scenario: SettlementScenario): AppState {
	const state: AppState = {
		version: 1,
		members: (
			[
				{ id: 'an', name: 'An', color: '#44735a', role: 'admin' },
				{ id: 'huy', name: 'Huy', color: '#7b8eaf', role: 'member' },
				{ id: 'linh', name: 'Linh', color: '#c58a60', role: 'member' },
				{ id: 'mai', name: 'Mai', color: '#b0788e', role: 'member' }
			] as const
		).map((member) => ({ ...member, active: true, bankCode: '', bankAccount: '' })),
		bills: [],
		ledger: [],
		settlements: [],
		receipts: [],
		archives: [],
		audit: []
	};
	const date = (hour: number) => new Date(Date.UTC(2026, 10, 8, hour)).toISOString();
	function bill(id: string, description: string, from: string, to: string, amount: number, hour: number) {
		applyCommand(
			state,
			to,
			'createBill',
			{
				id,
				description,
				date: date(hour),
				lines: [{ memberId: from, amount, description, note: '' }],
				discordNotification: false
			},
			date(hour)
		);
	}
	function settle(hour: number) {
		applyCommand(state, 'an', 'settleDebts', { id: `batch-${hour}`, version: state.version }, date(hour));
	}
	bill('com', 'Cơm', 'an', 'linh', 100_000, 1);
	bill('bun', 'Bún bò', 'huy', 'linh', scenario === 'partial' ? 40_000 : 60_000, 2);
	if (scenario === 'partial') bill('banh-mi', 'Bánh mì', 'huy', 'linh', 20_000, 3);
	if (scenario === 'first') {
		bill('tra', 'Trà đá', 'huy', 'an', 10_000, 3);
		bill('cafe', 'Cà phê', 'mai', 'huy', 20_000, 3);
		bill('lau', 'Lẩu', 'linh', 'mai', 20_000, 3);
	}
	settle(4);

	if (scenario === 'repeat') settle(5);
	if (scenario === 'partial' || scenario === 'newHub' || scenario === 'undo') {
		applyCommand(
			state,
			'huy',
			'confirmQrPayment',
			{ id: 'partial', to: 'an', amount: scenario === 'partial' ? 12_000 : 20_000 },
			date(5)
		);
		if (scenario === 'partial')
			applyCommand(state, 'huy', 'confirmQrPayment', { id: 'partial-2', to: 'an', amount: 8_000 }, date(6));
		if (scenario === 'newHub') bill('lau', 'Lẩu', 'mai', 'linh', 150_000, 6);
		if (scenario === 'undo') applyCommand(state, 'an', 'undoSettlement', { id: 'batch-4' }, date(7));
		else settle(7);
	}
	return state;
}
