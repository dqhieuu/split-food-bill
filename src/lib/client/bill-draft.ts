import { z } from 'zod';
import type { BillScan } from '../domain/ai';
import { BILL_IMAGE_ID, createBillInput, discountShares, equalShares, localDate } from '../domain/ledger';
import type { Bill, Member } from '../domain/types';
import { ApiError } from './api-error';

export const ROUNDING_OPTIONS = [0, 1, 2, 3, 4] as const;
const billDay = z.iso.date();
const inputAmount = z.number().nullable().catch(null);
const draftFields = z.object({
	description: z.string().max(300).catch(''),
	date: z
		.union([billDay, z.literal('')])
		.optional()
		.catch(undefined),
	selected: z.array(z.string()).optional().catch(undefined),
	payerId: z.string().optional().catch(undefined),
	amounts: z.record(z.string(), inputAmount).catch({}),
	descriptions: z.record(z.string(), z.string().max(300).catch('')).catch({}),
	mode: z.enum(['manual', 'equal']).catch('manual'),
	totalInput: inputAmount,
	discountInput: inputAmount,
	rounding: z.literal(ROUNDING_OPTIONS).catch(0),
	unit: z.literal([1, 1000]).catch(1000),
	alreadyPaid: z.boolean().catch(false),
	imageId: z.string().regex(BILL_IMAGE_ID).catch(''),
	submissionId: createBillInput.shape.id.optional().catch(undefined)
});
const submissionFields = createBillInput.extend({ payerId: createBillInput.shape.payerId.unwrap() });
export type BillSubmission = z.output<typeof submissionFields>;
type BillDraft = Omit<z.output<typeof draftFields>, 'date' | 'selected' | 'payerId' | 'submissionId'> & {
	date: string;
	selected: string[];
	payerId: string;
	submissionId: string;
};

export function newBillDraft(
	actor: string,
	today = localDate(new Date()),
	id: string = crypto.randomUUID()
): BillDraft {
	return {
		...draftFields.parse({}),
		date: today,
		selected: [actor],
		payerId: actor,
		submissionId: id
	};
}

function decodeDraft(raw: string | null) {
	try {
		if (raw) return draftFields.safeParse(JSON.parse(raw)).data;
	} catch {
		/* A malformed draft can be replaced by a fresh one. */
	}
}

export function restoreBillDraft(
	raw: string | null,
	defaults: BillDraft,
	editor: Member,
	people: Member[],
	requestedDate: string | null
): BillDraft {
	const saved = decodeDraft(raw);
	const date = billDay.safeParse(requestedDate).data ?? saved?.date ?? defaults.date;
	if (!saved) return { ...defaults, date };
	return {
		...saved,
		date,
		selected: activeSelection(saved.selected ?? defaults.selected, people),
		payerId: draftPayer(saved.payerId, editor, people).id,
		submissionId: saved.submissionId ?? defaults.submissionId
	};
}

function activeSelection(selected: string[], people: Member[]) {
	const ids = new Set(people.map(({ id }) => id));
	return [...new Set(selected)].filter((id) => ids.has(id));
}

function draftPayer(payerId: string | undefined, editor: Member, people: Member[]) {
	return (editor.active && editor.role === 'admin' && people.find(({ id }) => id === payerId)) || editor;
}

function dong(value: number | null | undefined, unit: BillDraft['unit']) {
	return Math.round((value ?? 0) * unit);
}

export function billDraftDetails(draft: BillDraft, editor: Member, people: Member[], attempted: boolean) {
	const selected = activeSelection(draft.selected, people);
	const description = draft.description.trim();
	const payer = draftPayer(draft.payerId, editor, people);
	const listed = selected.map((id) => dong(draft.amounts[id], draft.unit));
	const listedTotal = listed.reduce((sum, amount) => sum + amount, 0);
	const discounted = dong(draft.discountInput, draft.unit);
	const equalTotal = dong(draft.totalInput, draft.unit);
	const equal = draft.mode === 'equal';
	const hasDiscount = !equal && discounted > 0;
	const shares = equal
		? equalShares(equalTotal, selected.length, draft.rounding)
		: hasDiscount
			? discountShares(listed, discounted, draft.rounding)
			: listed;
	const lines = selected.map((memberId, index) => ({
		memberId,
		amount: shares[index] ?? 0,
		description: draft.descriptions[memberId]?.trim() || description,
		note: ''
	}));
	const total = lines.reduce((sum, line) => sum + line.amount, 0);
	const roundingExtra = equal || hasDiscount ? Math.max(0, total - (equal ? equalTotal : discounted)) : 0;
	const dateInvalid = !billDay.safeParse(draft.date).success;
	const discountInvalid =
		!equal &&
		((draft.discountInput ?? 0) < 0 ||
			(hasDiscount && listed.every((price) => price > 0) && shares.some((share) => share <= 0)));
	const amountInvalid = selected.map(
		(id, index) =>
			!equal &&
			((draft.amounts[id] ?? 0) < 0 ||
				((attempted || hasDiscount) && (listed[index] <= 0 || shares[index] <= 0)))
	);
	return {
		selected,
		payer,
		shares,
		lines,
		total,
		listedTotal,
		hasDiscount,
		roundingExtra,
		nameInvalid: attempted && !description,
		dateInvalid,
		totalInvalid: equal && ((draft.totalInput ?? 0) < 0 || (attempted && equalTotal <= 0)),
		discountInvalid,
		amountInvalid,
		error: validationMessage()
	};

	function validationMessage() {
		if (!description) return 'Hãy đặt tên cho hóa đơn.';
		if (dateInvalid) return 'Hãy chọn ngày hợp lệ.';
		if (!lines.length) return 'Chọn ít nhất một thành viên.';
		if (equal && equalTotal <= 0) return 'Hãy nhập tổng tiền cần chia.';
		if (!equal && listed.some((price) => price <= 0)) return 'Mỗi người được chọn cần có số tiền lớn hơn 0.';
		if (discountInvalid) return 'Giá sau khi giảm giá không hợp lệ.';
		if (lines.some(({ amount }) => !Number.isSafeInteger(amount) || amount <= 0))
			return 'Mỗi người được chọn cần có số tiền lớn hơn 0.';
		if (total > 1_000_000_000) return 'Tổng hóa đơn tối đa là 1 tỷ đồng.';
		return '';
	}
}

export function reviewBillDraft(
	draft: BillDraft,
	details: ReturnType<typeof billDraftDetails>,
	discordNotification: boolean
): { submission: BillSubmission } | { error: string } {
	if (details.error) return { error: details.error };
	const result = submissionFields.safeParse({
		id: draft.submissionId,
		description: draft.description,
		date: new Date(`${draft.date}T12:00:00+07:00`).toISOString(),
		payerId: details.payer.id,
		discordNotification,
		alreadyPaid: draft.alreadyPaid,
		...(draft.imageId ? { image: draft.imageId } : {}),
		lines: details.lines
	});
	return result.success ? { submission: result.data } : { error: 'Thông tin hóa đơn không hợp lệ.' };
}

export function reviewedBill(submission: BillSubmission, actor: string, members: Member[]): Bill {
	const { payerId, ...data } = submission;
	return {
		...data,
		organizer: payerId,
		creator: actor,
		total: submission.lines.reduce((sum, line) => sum + line.amount, 0),
		memberNames: Object.fromEntries(members.map(({ id, name }) => [id, name]))
	};
}

export function changeBillDraftMode(draft: BillDraft, mode: BillDraft['mode']): BillDraft {
	if (draft.mode === mode) return draft;
	if (mode === 'manual') return { ...draft, mode, discountInput: draft.totalInput };
	return { ...draft, mode, totalInput: draft.discountInput ?? draft.totalInput };
}

export function changeBillDraftUnit(draft: BillDraft, unit: BillDraft['unit']): BillDraft {
	const factor = draft.unit / unit;
	const scale = (value: number | null) => (value === null ? null : value * factor);
	return {
		...draft,
		unit,
		amounts: Object.fromEntries(Object.entries(draft.amounts).map(([id, value]) => [id, scale(value)])),
		totalInput: scale(draft.totalInput),
		discountInput: scale(draft.discountInput)
	};
}

export function applyBillDraftScan(draft: BillDraft, scan: BillScan) {
	const description = scan.billName.slice(0, 300);
	const date = scan.billDate ?? draft.date;
	const changes = {
		name: description !== draft.description,
		date: date !== draft.date,
		total:
			scan.totalCost > 0 && (draft.mode !== 'equal' || dong(draft.totalInput, draft.unit) !== scan.totalCost)
	};
	const next =
		scan.totalCost > 0 && scan.totalCost % draft.unit !== 0 ? changeBillDraftUnit(draft, 1) : draft;
	return {
		changes,
		draft: {
			...next,
			description,
			date,
			mode: 'equal' as const,
			totalInput: scan.totalCost > 0 ? scan.totalCost / next.unit : next.totalInput
		}
	};
}

export function createBillDraftStorage(
	getStorage: () => Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>,
	groupId: string,
	actor: string
) {
	const key = `lunchroom-draft-${groupId}-${actor}`;
	// Ordinary draft autosaves cannot overwrite an in-flight submission.
	const attemptKey = `${key}-attempt`;

	function readAttempt() {
		const raw = getStorage().getItem(attemptKey);
		return raw ? submissionFields.parse(JSON.parse(raw)) : null;
	}

	function save(draft: BillDraft) {
		getStorage().setItem(key, JSON.stringify(draft));
	}

	function finishAttempt(submission: BillSubmission, saved: boolean) {
		if (JSON.stringify(readAttempt()) !== JSON.stringify(submission)) return false;
		const storage = getStorage();
		if (saved && decodeDraft(storage.getItem(key))?.submissionId === submission.id) storage.removeItem(key);
		storage.removeItem(attemptKey);
		return true;
	}

	return {
		read: () => getStorage().getItem(key),
		save,
		readAttempt,
		beginAttempt(draft: BillDraft, reviewed: BillSubmission, retrying = false) {
			const pending = readAttempt();
			const submission = pending ?? reviewed;
			if (!pending) {
				save(draft);
				getStorage().setItem(attemptKey, JSON.stringify(submission));
			}
			return {
				submission,
				complete: () => finishAttempt(submission, true),
				reject(cause: unknown) {
					// A rejection of a retry does not resolve an earlier uncertain attempt.
					return !pending && !retrying && isConfirmedBillRejection(cause) && finishAttempt(submission, false);
				}
			};
		}
	};
}

function isConfirmedBillRejection(cause: unknown) {
	// A 403 can also come from reloading group state after the write has committed.
	return cause instanceof ApiError && [400, 401, 409, 422].includes(cause.status);
}
