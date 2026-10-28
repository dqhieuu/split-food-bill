import { DomainError } from '../../src/lib/domain/ledger';
import type { GlobalUser } from '../../src/lib/domain/types';
import type { Env } from './env';
import { sessionOperation } from './identity';
import type { DataStore as Store, Write } from './store';

export const RESET_CONFIRMATION = 'XÓA TOÀN BỘ';
const ACTIVE = 'database-reset:active';
const TTL = 3600000;
type Task = { kind: 'collections' | 'documents' | 'document'; path: string; pageToken?: string };
type Job = {
	id: string;
	actor: string;
	status: 'running' | 'complete';
	tasks: Task[];
	processedDocuments: number;
	passDocuments: number;
};
const jobKey = (id: string) => `database-reset:job:${id}`;
const summary = ({ id, status, processedDocuments }: Job) => ({ id, status, processedDocuments });

export async function requireAvailableDatabase(env: Env) {
	if (await sessionOperation(env, 'get', ACTIVE))
		throw new DomainError('Cơ sở dữ liệu đang được xóa. Vui lòng thử lại sau.', 503);
}

export async function startDatabaseReset(
	store: Store,
	env: Env,
	user: GlobalUser,
	id: string,
	confirmation: string
) {
	if (user.role !== 'admin') throw new DomainError('Chỉ quản trị viên hệ thống được xóa cơ sở dữ liệu.', 403);
	const current = await store.get<GlobalUser>(`users/${user.id}`);
	if (current?.role !== 'admin')
		throw new DomainError('Chỉ quản trị viên hệ thống được xóa cơ sở dữ liệu.', 403);
	if (confirmation !== RESET_CONFIRMATION) throw new DomainError('Nhập đúng XÓA TOÀN BỘ để xác nhận.', 400);
	if (!env.DISCORD_ADMIN_IDS?.split(',').some((value) => /^\d{17,20}$/.test(value.trim())))
		throw new DomainError('Cần cấu hình DISCORD_ADMIN_IDS để khôi phục quản trị viên sau khi xóa.', 400);
	const existing = await sessionOperation<Job | null>(env, 'get', jobKey(id));
	if (existing) {
		if (existing.actor !== user.id) throw new DomainError('Yêu cầu xóa thuộc tài khoản khác.', 403);
		return summary(existing);
	}
	const lock = { id, actor: user.id, challenge: id };
	if (!(await sessionOperation(env, 'claim', ACTIVE, { ttl: TTL, value: lock })))
		throw new DomainError('Một yêu cầu xóa cơ sở dữ liệu đang chạy.', 409);
	const job: Job = {
		id,
		actor: user.id,
		status: 'running',
		tasks: [{ kind: 'collections', path: '' }],
		processedDocuments: 0,
		passDocuments: 0
	};
	try {
		await sessionOperation(env, 'put', jobKey(id), { ttl: TTL, value: job });
	} catch (error) {
		await sessionOperation(env, 'take', ACTIVE, { challenge: id });
		throw error;
	}
	return summary(job);
}

/** Each request does bounded work and checkpoints only after its idempotent deletes commit. */
export async function continueDatabaseReset(store: Store, env: Env, actor: string, id: string) {
	let job = await sessionOperation<Job | null>(env, 'get', jobKey(id));
	if (!job) throw new DomainError('Không tìm thấy yêu cầu xóa hoặc yêu cầu đã hết hạn.', 404);
	if (job.actor !== actor) throw new DomainError('Yêu cầu xóa thuộc tài khoản khác.', 403);
	if (job.status === 'complete') {
		await sessionOperation(env, 'take', ACTIVE, { challenge: id });
		return summary(job);
	}
	const active = await sessionOperation<{ id: string } | null>(env, 'get', ACTIVE);
	if (active?.id !== id) throw new DomainError('Yêu cầu xóa không còn hoạt động.', 409);
	const step = `database-reset:step:${id}`;
	if (!(await sessionOperation(env, 'claim', step, { ttl: 300000 })))
		throw new DomainError('Một bước xóa đang chạy. Thử lại sau.', 409);
	try {
		job = (await sessionOperation<Job>(env, 'get', jobKey(id)))!;
		if (job.status === 'complete') {
			await sessionOperation(env, 'take', ACTIVE, { challenge: id });
			return summary(job);
		}
		const writes: Write[] = [];
		for (let count = 0; count < 12 && job.tasks.length; count++) {
			const task = job.tasks.pop()!;
			if (task.kind === 'collections') {
				const page = await store.collectionIds(task.path, task.pageToken);
				if (page.nextPageToken) job.tasks.push({ ...task, pageToken: page.nextPageToken });
				for (const collection of page.items)
					job.tasks.push({ kind: 'documents', path: task.path ? `${task.path}/${collection}` : collection });
			} else if (task.kind === 'documents') {
				const page = await store.documentPaths(task.path, task.pageToken);
				if (page.nextPageToken) job.tasks.push({ ...task, pageToken: page.nextPageToken });
				for (const path of page.items) job.tasks.push({ kind: 'document', path });
			} else {
				const page = await store.collectionIds(task.path);
				if (page.nextPageToken)
					job.tasks.push({ kind: 'collections', path: task.path, pageToken: page.nextPageToken });
				for (const collection of page.items)
					job.tasks.push({ kind: 'documents', path: `${task.path}/${collection}` });
				if (task.path !== `users/${actor}`) {
					writes.push(store.delete(task.path));
					job.processedDocuments++;
					job.passDocuments++;
				}
			}
		}
		if (!job.tasks.length && job.passDocuments) {
			job.tasks.push({ kind: 'collections', path: '' });
			job.passDocuments = 0;
		} else if (!job.tasks.length) {
			writes.push(store.delete(`users/${actor}`));
			job.processedDocuments++;
			job.status = 'complete';
		}
		await store.commit(writes);
		await sessionOperation(env, 'put', jobKey(id), { ttl: TTL, value: job });
		if (job.status === 'complete') await sessionOperation(env, 'take', ACTIVE, { challenge: id });
		else await sessionOperation(env, 'put', ACTIVE, { ttl: TTL, value: { id, actor, challenge: id } });
		return summary(job);
	} finally {
		await sessionOperation(env, 'take', step);
	}
}
