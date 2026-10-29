import { describe, expect, it } from 'vitest';
import { courtRanking } from '../../src/lib/domain/leaderboard';
import type { LedgerEntry, Member } from '../../src/lib/domain/types';

const member = (id: string, active = true): Member => ({
	id,
	name: id,
	active,
	role: 'member',
	bankCode: '',
	bankAccount: '',
	color: '#777777'
});
const debt = (from: string, to: string, amount: number, type: LedgerEntry['type'] = 'debt'): LedgerEntry => ({
	id: `${from}-${to}-${type}`,
	from,
	to,
	amount,
	type,
	date: '2026-10-29T00:00:00Z',
	description: '',
	note: '',
	creator: from,
	source: 'manual',
	reference: ''
});

describe('royal court rankings', () => {
	it('ranks net creditors first, excludes inactive members, and retains their ledger balances', () => {
		const ranks = courtRanking(
			['payer', 'crown', 'duke', 'citizen'].map((id) => member(id)).concat(member('former', false)),
			[
				debt('payer', 'crown', 100),
				debt('crown', 'payer', 20),
				debt('payer', 'duke', 30),
				debt('payer', 'former', 50)
			]
		);
		expect(ranks.map(({ member, credit, rank, tier }) => [member.id, credit, rank, tier])).toEqual([
			['crown', 80, 1, 'sovereign'],
			['duke', 30, 2, 'noble'],
			['citizen', 0, 3, 'commoner'],
			['payer', -160, 4, 'servant']
		]);
	});
	it('gives equal balances equal ranks and titles with deterministic ordering', () => {
		const people = ['payer', 'b', 'a', 'c'].map((id) => member(id));
		const ledger = [debt('payer', 'a', 50), debt('payer', 'b', 50), debt('payer', 'c', 20)];
		const ranks = courtRanking(people, ledger);
		expect(ranks.map(({ member, rank, title }) => [member.id, rank, title])).toEqual([
			['a', 1, 'Quân vương'],
			['b', 1, 'Quân vương'],
			['c', 3, 'Hầu tước'],
			['payer', 4, 'Nô bộc']
		]);
		expect(courtRanking([...people].reverse(), ledger)).toEqual(ranks);
	});
	it('moves the crown after repayment, and leaves the throne vacant when everyone is settled', () => {
		const people = ['payer', 'a', 'b'].map((id) => member(id));
		const ledger = [debt('payer', 'a', 100), debt('payer', 'b', 20)];
		ledger.push(debt('payer', 'a', 100, 'payment'));
		expect(courtRanking(people, ledger)[0].member.id).toBe('b');
		ledger.push(debt('payer', 'b', 20, 'payment'));
		expect(
			courtRanking(people, ledger).every(
				(entry) => entry.credit === 0 && entry.rank === 1 && entry.tier === 'commoner'
			)
		).toBe(true);
	});
	it('handles empty courts and courts that only owe inactive members without crowning a debtor', () => {
		expect(courtRanking([], [])).toEqual([]);
		const ranks = courtRanking([member('payer'), member('former', false)], [debt('payer', 'former', 30)]);
		expect(ranks).toHaveLength(1);
		expect(ranks[0]).toMatchObject({ rank: 1, credit: -30, tier: 'servant', title: 'Nô bộc' });
	});
});
