import { netBalance } from './ledger';
import type { LedgerEntry, Member } from './types';

export type CourtTier = 'sovereign' | 'noble' | 'commoner' | 'servant';
export type CourtRank = {
	member: Member;
	/** Positive means this member is owed money, matching netBalance. */
	credit: number;
	rank: number;
	tier: CourtTier;
	title: string;
};

/** Rank active members using the complete ledger, including balances with inactive members. */
export function courtRanking(members: Member[], ledger: LedgerEntry[]): CourtRank[] {
	const positions = members
		.filter((member) => member.active)
		.map((member) => ({ member, credit: netBalance(ledger, member.id) }))
		.sort(
			(a, b) =>
				b.credit - a.credit ||
				a.member.name.localeCompare(b.member.name, 'vi') ||
				a.member.id.localeCompare(b.member.id)
		);
	let rank = 1;
	return positions.map((position, index) => {
		if (index && position.credit !== positions[index - 1].credit) rank = index + 1;
		const tier: CourtTier =
			position.credit > 0
				? rank === 1
					? 'sovereign'
					: 'noble'
				: position.credit === 0
					? 'commoner'
					: 'servant';
		const title =
			tier === 'sovereign'
				? 'Quân vương'
				: tier === 'noble'
					? rank === 2
						? 'Công tước'
						: rank === 3
							? 'Hầu tước'
							: 'Quý tộc'
					: tier === 'commoner'
						? 'Thường dân'
						: 'Nô bộc';
		return { ...position, rank, tier, title };
	});
}
