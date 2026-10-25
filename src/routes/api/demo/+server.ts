import { json } from '@sveltejs/kit';
import { ensureDemoState, getLocalFirebase, loadState, demoPassword } from '$lib/server/firebase';
import { apiError } from '$lib/server/http';

export async function GET() {
	try {
		await ensureDemoState();
		const state = await loadState();
		return json({
			members: state.members
				.filter((m) => m.active)
				.map(({ id, name, role, color }) => ({ id, name, role, color }))
		});
	} catch (error) {
		return apiError(error);
	}
}
export async function POST({ request }: { request: Request }) {
	try {
		const { memberId } = await request.json();
		const state = await loadState();
		const member = state.members.find((m) => m.id === memberId && m.active);
		if (!member) return json({ message: 'Không tìm thấy tài khoản.' }, { status: 404 });
		const { auth } = getLocalFirebase();
		try {
			const account = await auth.getUser(member.id);
			if (account.email !== member.email) await auth.updateUser(member.id, { email: member.email });
		} catch (error) {
			if ((error as { code?: string }).code !== 'auth/user-not-found') throw error;
			await auth.createUser({
				uid: member.id,
				email: member.email,
				password: demoPassword,
				displayName: member.name
			});
		}
		return json({ email: member.email, password: demoPassword });
	} catch (error) {
		return apiError(error);
	}
}
