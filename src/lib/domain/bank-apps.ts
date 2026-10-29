import { banks } from './banks';
import type { Member } from './types';

export type BankPlatform = 'android' | 'ios';
export type BankApp = {
	id: string;
	bank: string;
	name: string;
	autofill?: boolean;
	androidOnly?: boolean;
};

// Verified 2026-10-29 against https://www.vietqr.io/deeplink/bank-apps and
// https://api.vietqr.io/v2/{android,ios}-app-deeplinks. Keep discovery local;
// the external service receives payment details only when the user taps the QR.
export const bankApps: readonly BankApp[] = [
	{ bank: 'VTB', id: 'icb', name: 'VietinBank iPay', autofill: true },
	{ bank: 'BIDV', id: 'bidv', name: 'BIDV SmartBanking', autofill: true },
	{ bank: 'OCB', id: 'ocb', name: 'OCB OMNI', autofill: true },
	{ bank: 'ACB', id: 'acb', name: 'ACB ONE', autofill: true },
	{ bank: 'MB', id: 'mb', name: 'MB Bank', autofill: true },
	{ bank: 'VCB', id: 'vcb', name: 'VCB Digibank' },
	{ bank: 'TCB', id: 'tcb', name: 'Techcombank Mobile' },
	{ bank: 'VPB', id: 'vpb', name: 'VPBank NEO' },
	{ bank: 'VIB', id: 'vib-2', name: 'MyVIB' },
	{ bank: 'SHB', id: 'shb', name: 'SHB SAHA' },
	{ bank: 'LPB', id: 'lpb', name: 'LPBank' },
	{ bank: 'SAB', id: 'seab', name: 'SeAMobile' },
	{ bank: 'SCB', id: 'scb', name: 'SCB Mobile Banking' },
	{ bank: 'CAKE', id: 'cake', name: 'CAKE' },
	{ bank: 'HDB', id: 'hdb', name: 'HDBank' },
	{ bank: 'AGR', id: 'vba', name: 'Agribank Plus' },
	{ bank: 'TPB', id: 'tpb', name: 'TPBank Mobile' },
	{ bank: 'TIMO', id: 'timo', name: 'Timo' },
	{ bank: 'VIB', id: 'vib', name: 'MyVIB (bản cũ)', androidOnly: true },
	{ bank: 'SHINHAN', id: 'shbvn', name: 'Shinhan SOL Việt Nam' },
	{ bank: 'NAB', id: 'nab', name: 'Nam A Bank Open Banking' },
	{ bank: 'ABB', id: 'abb', name: 'ABBank' },
	{ bank: 'EIB', id: 'eib', name: 'Eximbank EDigi' },
	{ bank: 'COOPBANK', id: 'coopbank', name: 'Co-opBank Mobile Banking' },
	{ bank: 'PVCB', id: 'pvcb', name: 'PVConnect' },
	{ bank: 'WRB', id: 'wvn', name: 'Woori WON Vietnam' },
	{ bank: 'KLB', id: 'klb', name: 'KienlongBank Plus' },
	{ bank: 'BVB', id: 'bvb', name: 'BAOVIET Smart' },
	{ bank: 'VAB', id: 'vab', name: 'Vietbank Digital Plus' },
	{ bank: 'NCB', id: 'ncb', name: 'NCB iziMobile' },
	{ bank: 'ACB', id: 'acb-biz', name: 'ACB ONE Biz' },
	{ bank: 'MBV', id: 'oceanbank', name: 'Ocean Bank Mobile Banking' },
	{ bank: 'PBVN', id: 'pbvn', name: 'PB engage VN' },
	{ bank: 'SBC', id: 'sgicb', name: 'SAIGONBANK Smart Banking' },
	{ bank: 'CIMB', id: 'cimb', name: 'Octo by CIMB Vietnam' }
];

// Provider transfer codes differ from some of the profile directory's codes.
// Source: https://api.vietqr.io/v2/banks (2026-10-29). BIN remains authoritative.
const transferCodeOverrides: Record<string, string> = {
	'970448': 'ocb',
	'668888': 'kbank',
	'970457': 'wvn',
	'963666': 'bnp hcm',
	'970415': 'icb',
	'970442': 'hlbvn',
	'970466': 'kebhanahcm',
	'963668': 'bnp hn',
	'970406': 'vikki',
	'970454': 'vccb',
	'801011': 'nhb hn',
	'970424': 'shbvn',
	'970400': 'sgicb',
	'970405': 'vba',
	'970440': 'seab',
	'970433': 'vietbank',
	'970452': 'klb',
	'970467': 'kebhanahn'
};

export function mobileBankPlatform(
	userAgent: string,
	platform = '',
	maxTouchPoints = 0
): BankPlatform | null {
	if (/android/i.test(userAgent)) return 'android';
	if (/iphone|ipad|ipod/i.test(userAgent) || (platform === 'MacIntel' && maxTouchPoints > 1)) return 'ios';
	return null;
}

export function bankAppsForMember(
	member: Pick<Member, 'bankCode' | 'bankLabel'>,
	platform: BankPlatform
): readonly BankApp[] {
	const candidates = banks.filter((bank) => bank.bin && bank.bin === member.bankCode);
	const normalize = (value: string) => value.toLocaleLowerCase('vi').replace(/[^\p{L}\p{N}]/gu, '');
	const label = member.bankLabel ? normalize(member.bankLabel) : '';
	// Digital brands can share a routing BIN with another bank, but use a different app.
	const bank =
		candidates.find((candidate) =>
			[candidate.code, candidate.shortName, candidate.name].some((name) => label && normalize(name) === label)
		) ??
		candidates.find((candidate) => candidate.aliases.some((name) => label && normalize(name) === label)) ??
		candidates.find((candidate) => bankApps.some((app) => app.bank === candidate.code));
	return bankApps.filter((app) => app.bank === bank?.code && (!app.androidOnly || platform === 'android'));
}

export function bankTransferLink({
	appId,
	recipient,
	amount,
	description,
	returnUrl
}: {
	appId: string;
	recipient: Pick<Member, 'bankCode' | 'bankAccount'>;
	amount: number;
	description: string;
	returnUrl: string;
}): string | null {
	const bank = banks.find((candidate) => candidate.bin && candidate.bin === recipient.bankCode);
	if (
		!bankApps.some((app) => app.id === appId) ||
		!bank ||
		!/^[a-z0-9]{1,40}$/i.test(recipient.bankAccount) ||
		!Number.isSafeInteger(amount) ||
		amount <= 0 ||
		!description.trim()
	)
		return null;
	let callback: URL;
	try {
		callback = new URL(returnUrl);
	} catch {
		return null;
	}
	if (!['https:', 'http:'].includes(callback.protocol)) return null;
	callback.hash = '';
	const link = new URL('https://dl.vietqr.io/pay');
	link.search = new URLSearchParams({
		app: appId,
		ba: `${recipient.bankAccount}@${transferCodeOverrides[bank.bin] ?? bank.code.toLowerCase()}`,
		am: String(amount),
		tn: description.slice(0, 25),
		url: callback.href
	}).toString();
	return link.href;
}
