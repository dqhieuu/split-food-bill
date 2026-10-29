import { describe, expect, it } from 'vitest';
import {
	bankApps,
	bankAppsForMember,
	bankTransferLink,
	mobileBankPlatform
} from '../../src/lib/domain/bank-apps';
import { banks } from '../../src/lib/domain/banks';

describe('mobile bank apps', () => {
	it('detects Android, iPhone and iPads without treating desktop browsers as phones', () => {
		expect(mobileBankPlatform('Mozilla/5.0 (Linux; Android 15; Pixel 9)')).toBe('android');
		expect(mobileBankPlatform('Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)')).toBe('ios');
		expect(mobileBankPlatform('Mozilla/5.0 (Macintosh; Intel Mac OS X)', 'MacIntel', 5)).toBe('ios');
		expect(mobileBankPlatform('Mozilla/5.0 (Macintosh; Intel Mac OS X)', 'MacIntel', 0)).toBeNull();
		expect(mobileBankPlatform('Mozilla/5.0 (Windows NT 10.0; Win64; x64)')).toBeNull();
	});

	it('routes every listed app through a saved bank and respects platform-specific variants', () => {
		for (const app of bankApps) {
			const bank = banks.find((candidate) => candidate.code === app.bank)!;
			expect(bank, app.id).toBeDefined();
			const member = { bankCode: bank.bin, bankLabel: bank.shortName };
			expect(bankAppsForMember(member, 'android').map((option) => option.id)).toContain(app.id);
			expect(bankAppsForMember(member, 'ios').some((option) => option.id === app.id)).toBe(!app.androidOnly);
		}
		expect(bankAppsForMember({ bankCode: '970416' }, 'ios').map((app) => app.id)).toEqual(['acb', 'acb-biz']);
		expect(bankAppsForMember({ bankCode: '970441' }, 'ios').map((app) => app.id)).toEqual(['vib-2']);
		expect(bankAppsForMember({ bankCode: '970441' }, 'android').map((app) => app.id)).toEqual([
			'vib-2',
			'vib'
		]);
	});

	it('uses the chosen bank brand when different apps share the same routing BIN', () => {
		expect(bankAppsForMember({ bankCode: '970448', bankLabel: 'OCB' }, 'ios')[0].id).toBe('ocb');
		expect(bankAppsForMember({ bankCode: '970448' }, 'ios')[0].id).toBe('ocb');
		expect(bankAppsForMember({ bankCode: '970448', bankLabel: 'LioBank' }, 'ios')).toEqual([]);
		expect(bankAppsForMember({ bankCode: '970452', bankLabel: 'Umee' }, 'android')).toEqual([]);
		expect(bankAppsForMember({ bankCode: '' }, 'android')).toEqual([]);
		expect(bankAppsForMember({ bankCode: '123456' }, 'ios')).toEqual([]);
	});

	it('only advertises autofill for apps that the provider supports', () => {
		expect(
			bankApps
				.filter((app) => app.autofill)
				.map((app) => app.id)
				.sort()
		).toEqual(['acb', 'bidv', 'icb', 'mb', 'ocb']);
		expect(bankAppsForMember({ bankCode: '970436' }, 'ios')[0].autofill).toBeFalsy();
	});
});

describe('bank transfer links', () => {
	const payment = {
		appId: 'bidv',
		recipient: { bankCode: '970436', bankAccount: '00000123' },
		amount: 55000,
		description: 'CHIATIENAN 1234abcd',
		returnUrl: 'https://lunch.example/balances?group=team&member=huy'
	};

	it('keeps the source app separate from the recipient bank and encodes exact transfer details', () => {
		const link = new URL(bankTransferLink(payment)!);
		expect(link.origin + link.pathname).toBe('https://dl.vietqr.io/pay');
		expect(Object.fromEntries(link.searchParams)).toEqual({
			app: 'bidv',
			ba: '00000123@vcb',
			am: '55000',
			tn: 'CHIATIENAN 1234abcd',
			url: payment.returnUrl
		});
	});

	it.each([
		['970415', 'icb'],
		['970405', 'vba'],
		['970457', 'wvn'],
		['970424', 'shbvn'],
		['970400', 'sgicb'],
		['970448', 'ocb'],
		['970452', 'klb']
	])('uses the provider bank code for recipient BIN %s', (bankCode, code) => {
		const link = new URL(bankTransferLink({ ...payment, recipient: { bankCode, bankAccount: '0001' } })!);
		expect(link.searchParams.get('ba')).toBe(`0001@${code}`);
	});

	it('encodes special memo characters and strips login fragments from the return URL', () => {
		const description = 'Ăn trưa & cà phê + #1';
		const link = new URL(
			bankTransferLink({ ...payment, description, returnUrl: `${payment.returnUrl}#auth_code=secret` })!
		);
		expect(link.searchParams.get('tn')).toBe(description);
		expect(link.searchParams.get('url')).toBe(payment.returnUrl);
		expect(link.searchParams.has('auth_code')).toBe(false);
		expect(link.searchParams.get('app')).toBe('bidv');
	});

	it('does not produce links with invalid accounts, unsupported apps or unusable amounts', () => {
		for (const amount of [0, -1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
			expect(bankTransferLink({ ...payment, amount })).toBeNull();
		}
		for (const bankAccount of ['', '123@other', '123&am=999', 'x'.repeat(41)]) {
			expect(bankTransferLink({ ...payment, recipient: { ...payment.recipient, bankAccount } })).toBeNull();
		}
		expect(
			bankTransferLink({ ...payment, recipient: { ...payment.recipient, bankCode: '123456' } })
		).toBeNull();
		expect(bankTransferLink({ ...payment, appId: 'unknown' })).toBeNull();
		expect(bankTransferLink({ ...payment, description: ' ' })).toBeNull();
		for (const returnUrl of ['javascript:alert(1)', 'not a url']) {
			expect(bankTransferLink({ ...payment, returnUrl })).toBeNull();
		}
	});
});
