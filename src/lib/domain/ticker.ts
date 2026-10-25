import type { Member } from './types';

const plain = (value: string) =>
	value
		.normalize('NFD')
		.replace(/[̀-ͯ]/g, '')
		.replace(/[đĐ]/g, 'D')
		.toUpperCase()
		.replace(/[^A-Z\s]/g, ' ')
		.split(/\s+/)
		.filter(Boolean);

/**
 * Candidate codes for a Vietnamese full name ("Family Middle Given"), mirroring the legacy sheet
 * formula on `given.family` usernames: given initial + first two letters of the family name.
 */
function candidates(name: string, id: string): string[] {
	const words = plain(name);
	if (!words.length)
		return [
			id
				.toUpperCase()
				.replace(/[^A-Z]/g, '')
				.slice(0, 3) || 'XXX'
		];
	if (words.length === 1) return [words[0].slice(0, 3).padEnd(3, 'X')];
	const given = words.at(-1)!;
	const family = words[0];
	const middle = words.slice(1, -1);
	return [
		(given[0] + family.slice(0, 2)).padEnd(3, 'X'),
		middle.length ? given[0] + middle[0][0] + family[0] : given.slice(0, 2) + family[0],
		given + family[0]
	];
}

/** Unique ticker-style codes keyed by member id, e.g. "Đặng Hoàng" → "HDA". */
export function tickerCodes(members: Pick<Member, 'id' | 'name'>[]): Record<string, string> {
	const used = new Set<string>();
	const codes: Record<string, string> = {};
	for (const member of members) {
		const options = candidates(member.name, member.id);
		let code = options.find((option) => !used.has(option));
		for (let suffix = 2; !code; suffix++) {
			const numbered = options[0] + suffix;
			if (!used.has(numbered)) code = numbered;
		}
		used.add(code);
		codes[member.id] = code;
	}
	return codes;
}
