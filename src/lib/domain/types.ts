export type Member = {
	id: string;
	name: string;
	active: boolean;
	role: 'admin' | 'member';
	bankCode: string;
	bankLabel?: string;
	bankAccount: string;
	color: string;
	avatarUrl?: string;
};
export type GlobalUser = {
	id: string;
	discordId: string;
	role: 'admin' | 'member';
	name: string;
	username: string;
	avatarUrl: string;
	email: string;
	lastActiveGroupId?: string;
	createdAt: string;
	updatedAt: string;
};
export type Group = {
	id: string;
	name: string;
	discordGuildId: string;
	createdBy: string;
	createdAt: string;
	version: number;
	/** True while the group has a complete AI configuration; the settings themselves stay server-side. */
	aiEnabled?: boolean;
};
export type GroupSummary = Group & { role: 'admin' | 'member' };
export type Session = { user: GlobalUser; groups: GroupSummary[]; selectedGroupId: string | null };
export type LedgerEntry = {
	id: string;
	from: string;
	to: string;
	type: 'debt' | 'payment';
	amount: number;
	date: string;
	/** Server creation time; older imported history may omit it. */
	createdAt?: string;
	description: string;
	note: string;
	creator: string;
	source: 'bill' | 'manual' | 'qr' | 'settlement' | 'import' | 'reversal';
	reference: string;
	legacySequence?: string;
};
export type BillLine = { memberId: string; amount: number; description: string; note: string };
export type Bill = {
	id: string;
	organizer: string;
	description: string;
	date: string;
	createdAt?: string;
	lines: BillLine[];
	total: number;
	discordNotification: boolean;
	memberNames?: Record<string, string>;
	/** Object-storage id of the receipt photo, stored under the group's prefix. */
	image?: string;
	/** Set once when the bill is undone; an undone bill can never be undone or restored again. */
	undoneAt?: string;
	undoneBy?: string;
};
export type NotificationDelivery = {
	memberId: string;
	status: 'queued' | 'sending' | 'sent' | 'simulated' | 'failed';
	error: string;
};
export type Receipt = {
	id: string;
	billId: string;
	status: NotificationDelivery['status'];
	recipients: string[];
	deliveries: NotificationDelivery[];
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
export type Archive = { id: string; name: string; url: string; date: string };
export type AuditEvent = { id: string; actor: string; action: string; date: string; reference: string };
export type AppState = {
	version: number;
	members: Member[];
	ledger: LedgerEntry[];
	bills: Bill[];
	receipts: Receipt[];
	settlements: Settlement[];
	archives: Archive[];
	audit: AuditEvent[];
};
export type CollectionKey = Exclude<keyof AppState, 'version'>;
export const collectionKeys: CollectionKey[] = [
	'members',
	'ledger',
	'bills',
	'receipts',
	'settlements',
	'archives',
	'audit'
];
export type SettlementPlan = {
	version: number;
	hub: string;
	entries: Omit<LedgerEntry, 'id' | 'date' | 'creator' | 'reference'>[];
};
