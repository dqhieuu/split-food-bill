export type Member = {
	id: string;
	name: string;
	email: string;
	team: string;
	active: boolean;
	role: 'admin' | 'member';
	bankCode: string;
	bankAccount: string;
	bankName: string;
	color: string;
};
export type LedgerEntry = {
	id: string;
	from: string;
	to: string;
	type: 'debt' | 'payment';
	amount: number;
	date: string;
	description: string;
	note: string;
	creator: string;
	source: 'bill' | 'manual' | 'qr' | 'settlement' | 'import';
	reference: string;
	legacySequence?: string;
};
export type BillLine = { memberId: string; amount: number; description: string; note: string };
export type Bill = {
	id: string;
	organizer: string;
	description: string;
	date: string;
	lines: BillLine[];
	total: number;
	emailReceipt: boolean;
	memberNames?: Record<string, string>;
};
export type PaymentIntent = {
	id: string;
	from: string;
	to: string;
	amount: number;
	balance: number;
	expiresAt: string;
	status: 'pending' | 'confirmed' | 'cancelled';
	createdAt: string;
};
export type Receipt = {
	id: string;
	billId: string;
	status: 'queued' | 'simulated' | 'failed';
	recipients: string[];
	attempts: number;
	error: string;
	createdAt: string;
};
export type Settlement = {
	id: string;
	hub: string;
	date: string;
	creator: string;
	version: number;
	entryCount: number;
};
export type Meal = { id: string; day: string; dish: string; note: string; date: string };
export type Archive = { id: string; name: string; url: string; date: string };
export type AuditEvent = { id: string; actor: string; action: string; date: string; reference: string };
export type UserPreference = { id: string; lastSeenRelease: string };
export type AppState = {
	version: number;
	members: Member[];
	ledger: LedgerEntry[];
	bills: Bill[];
	intents: PaymentIntent[];
	receipts: Receipt[];
	settlements: Settlement[];
	meals: Meal[];
	archives: Archive[];
	audit: AuditEvent[];
	preferences: UserPreference[];
};
export type CollectionKey = Exclude<keyof AppState, 'version'>;
export const collectionKeys: CollectionKey[] = [
	'members',
	'ledger',
	'bills',
	'intents',
	'receipts',
	'settlements',
	'meals',
	'archives',
	'audit',
	'preferences'
];
export type SettlementPlan = {
	version: number;
	hub: string;
	entries: Omit<LedgerEntry, 'id' | 'date' | 'creator' | 'reference'>[];
};
