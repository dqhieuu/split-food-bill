import { json } from '@sveltejs/kit';
import { actorFromRequest, mutateState } from '$lib/server/firebase';
import { applyCommand, DomainError } from '$lib/domain/ledger';
import { apiError } from '$lib/server/http';
export async function POST({ request, params }: { request: Request; params: { command: string } }) {
	try {
		// Only same-origin browser mutations are accepted. API tests may omit Origin.
		const origin = request.headers.get('origin');
		if (origin && origin !== new URL(request.url).origin)
			throw new DomainError('Nguồn yêu cầu không hợp lệ.', 403);
		if (Number(request.headers.get('content-length')) > 1_000_000)
			throw new DomainError('Dữ liệu quá lớn.', 413);
		const actor = await actorFromRequest(request);
		const input = await request.json();
		return json(await mutateState((state) => applyCommand(state, actor, params.command, input)));
	} catch (error) {
		return apiError(error);
	}
}
