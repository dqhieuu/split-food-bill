import { json } from '@sveltejs/kit';
import { actorFromRequest, loadState } from '$lib/server/firebase';
import { apiError } from '$lib/server/http';
import { DomainError } from '$lib/domain/ledger';
export async function GET({ request }: { request: Request }) {
	try {
		const actor = await actorFromRequest(request);
		const state = await loadState();
		if (!state.members.some((m) => m.id === actor && m.active))
			throw new DomainError('Tài khoản đã ngừng hoạt động.', 403);
		return json({ state, actor });
	} catch (error) {
		return apiError(error);
	}
}
