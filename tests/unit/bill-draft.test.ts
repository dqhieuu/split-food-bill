import { describe, expect, it } from 'vitest';
import { ApiError } from '../../src/lib/client/api-error';
import {
	applyBillDraftScan,
	billDraftDetails,
	changeBillDraftMode,
	changeBillDraftUnit,
	createBillDraftStorage,
	newBillDraft,
	restoreBillDraft,
	reviewBillDraft,
	reviewedBill
} from '../../src/lib/client/bill-draft';
import { applyCommand } from '../../src/lib/domain/ledger';
import { createDemoState } from '../../src/lib/domain/seed';

const day = '2026-11-12';
const now = `${day}T04:00:00.000Z`;
const defaultDraft = () => newBillDraft('an', day, 'draft-bill');

function setup() {
	const state = createDemoState(new Date(now));
	const people = state.members.filter((member) => member.active);
	const editor = people.find((member) => member.id === 'an')!;
	const draft = {
		...defaultDraft(),
		description: '  Cơm trưa  ',
		selected: ['an', 'huy'],
		payerId: 'linh',
		amounts: { an: 45, huy: 55 },
		descriptions: { an: '  Cơm gà  ', huy: '  ' },
		discountInput: 80.001
	};
	const details = billDraftDetails(draft, editor, people, true);
	const result = reviewBillDraft(draft, details, true);
	if ('error' in result) throw new Error(result.error);
	return { draft, editor, people, state, submission: result.submission };
}

function draftStore() {
	const values = new Map<string, string>();
	const adapter = {
		getItem: (key: string) => values.get(key) ?? null,
		setItem: (key: string, value: string) => {
			values.set(key, value);
		},
		removeItem: (key: string) => {
			values.delete(key);
		}
	};
	return (group: string, actor = 'an') => createBillDraftStorage(() => adapter, group, actor);
}

describe('bill drafts', () => {
	it('restores legacy fields, filters inactive or duplicate members, and ignores a stale payer and preference', () => {
		const { editor, people } = setup();
		const saved = JSON.stringify({
			description: 'Bản nháp',
			date: '2026-11-09',
			selected: ['an', 'former', 'huy', 'huy'],
			payerId: 'linh',
			amounts: { an: 20.5, huy: 'invalid' },
			unit: 1000,
			rounding: 9,
			submissionId: 'legacy-bill',
			discordNotification: false
		});
		const restored = restoreBillDraft(saved, defaultDraft(), { ...editor, role: 'member' }, people, day);
		expect(restored).toMatchObject({
			description: 'Bản nháp',
			date: day,
			selected: ['an', 'huy'],
			payerId: 'an',
			amounts: { an: 20.5, huy: null },
			rounding: 0,
			mode: 'manual',
			submissionId: 'legacy-bill',
			alreadyPaid: false
		});
		expect(restored).not.toHaveProperty('discordNotification');
		expect(restoreBillDraft('{bad', defaultDraft(), editor, people, null)).toEqual(defaultDraft());
		expect(restoreBillDraft('{"date":""}', defaultDraft(), editor, people, null).date).toBe('');
	});

	it('prepares the same bill for review and the ledger, including split amounts and Vietnam-local date', () => {
		const { state, submission } = setup();
		const preview = reviewedBill(submission, 'an', state.members);
		expect(submission).toMatchObject({
			description: 'Cơm trưa',
			date: `${day}T05:00:00.000Z`,
			payerId: 'linh',
			lines: [
				{ memberId: 'an', description: 'Cơm gà' },
				{ memberId: 'huy', description: 'Cơm trưa' }
			]
		});
		expect(preview.total).toBe(80001);
		applyCommand(state, 'an', 'createBill', submission, now);
		expect(state.bills.find((bill) => bill.id === submission.id)).toMatchObject(preview);
	});

	it('keeps manual prices through mode and unit changes and when AI returns a total without a date', () => {
		const { draft, editor, people } = setup();
		const equal = changeBillDraftMode(draft, 'equal');
		const inDong = changeBillDraftUnit(equal, 1);
		expect(inDong).toMatchObject({ totalInput: 80001, amounts: { an: 45000, huy: 55000 } });
		expect(changeBillDraftMode(inDong, 'manual').discountInput).toBe(80001);
		const scanned = applyBillDraftScan(draft, { billName: 'Cơm tấm', billDate: null, totalCost: 98765 });
		expect(scanned.draft).toMatchObject({ unit: 1, totalInput: 98765, date: day, mode: 'equal' });
		expect(scanned.changes).toEqual({ name: true, date: false, total: true });
		expect(billDraftDetails(scanned.draft, editor, people, true).total).toBe(98765);
	});
});

describe('bill draft submissions', () => {
	it('reuses the original reviewed request after reload and later draft edits', () => {
		const { draft, submission } = setup();
		const storage = draftStore();
		const original = storage('lunch');
		expect(original.beginAttempt(draft, submission).submission).toEqual(submission);
		const laterDraft = { ...draft, description: 'Edited draft' };
		original.save(laterDraft);

		const reloaded = storage('lunch');
		const retry = reloaded.beginAttempt(laterDraft, { ...submission, description: 'Edited draft' });
		expect(retry.submission).toEqual(submission);
		expect(retry.reject(new ApiError('Invalid amount', 400))).toBe(false);
		expect(storage('dinner').readAttempt()).toBeNull();
		expect(storage('lunch', 'huy').readAttempt()).toBeNull();
		retry.complete();
		expect(reloaded.read()).toBeNull();
		expect(reloaded.readAttempt()).toBeNull();
	});

	it('keeps the editable draft on confirmed rejection and preserves attempts on uncertain errors', () => {
		const { draft, submission } = setup();
		const storage = draftStore()('lunch');
		const attempt = storage.beginAttempt(draft, submission);
		expect(attempt.reject(new ApiError('Invalid amount', 400))).toBe(true);
		expect(storage.readAttempt()).toBeNull();
		expect(JSON.parse(storage.read()!)).toEqual(draft);

		const uncertain = storage.beginAttempt(draft, submission);
		for (const cause of [
			new TypeError('Failed to fetch'),
			new ApiError('Unavailable', 503),
			new ApiError('Forbidden', 403)
		]) {
			expect(uncertain.reject(cause)).toBe(false);
		}
		expect(storage.readAttempt()).toEqual(submission);
	});
});
