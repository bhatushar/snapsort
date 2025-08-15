import { type Actions, redirect } from '@sveltejs/kit';

export const actions: Actions = {
	logout: async ({ cookies }) => {
		cookies.delete('auth-token', {
			httpOnly: true,
			secure: false,
			sameSite: 'strict',
			path: '/'
		});
		// Redirect with GET (status 303)
		redirect(303, '/login');
	}
};
