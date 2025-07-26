import type { PageServerLoad } from '../$types';
import { getLoginPassword, setLoginPassword } from '$lib/server/db';
import { type Actions, fail } from '@sveltejs/kit';
import { z, ZodError } from 'zod';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import { env } from '$env/dynamic/private';

/**
 * Schema for password validation.
 */
const PasswordSchema = z.string().min(8, 'Password must be at least 8 characters long.');

export const load: PageServerLoad = async (): Promise<{ passwordRegistered: boolean }> => {
	const passwordRegistered = (await getLoginPassword()) !== undefined;
	return { passwordRegistered };
};

export const actions: Actions = {
	// Create a new login password
	registerPassword: async ({ request, cookies }) => {
		try {
			const currentPassword = await getLoginPassword();
			if (currentPassword)
				fail(400, { errors: ['Password is already registered. Cannot create new one.'] });

			const formData = await request.formData();
			const password = PasswordSchema.parse(formData.get('password'));

			// Store new password
			const saltRounds = 10;
			const passwordHash = await bcrypt.hash(password, saltRounds);
			await setLoginPassword(passwordHash);

			// JWT token for authorization
			const token = jwt.sign({ id: 'admin' }, env.JWT_SECRET_KEY as string);
			cookies.set('auth-token', token, {
				httpOnly: true,
				secure: false,
				sameSite: 'strict',
				path: '/',
				maxAge: 24 * 60 * 60 // retain for one day
			});

			return { success: true };
		} catch (error) {
			if (error instanceof ZodError) {
				// Password didn't meet minimum criteria
				const errors = error.issues.map((issue) => issue.message);
				console.error('[login.server.ts:actions.registerPassword] zod error:', error);
				return fail(400, { errors });
			}
			console.error('[login.server.ts:actions.registerPassword]', error);
			return fail(500, {
				errors: ['Internal failure. Check server logs for details.']
			});
		}
	},
	// Login handler
	login: async ({ request, cookies }) => {
		try {
			const formData = await request.formData();
			const password = PasswordSchema.parse(formData.get('password'));
			const passwordHash = await getLoginPassword();

			console.debug(`[login.server.ts:actions.login] password: ${password} hash: ${passwordHash}`);

			if (!passwordHash)
				return fail(400, {
					errors: ['No password is registered. Create a new password to login.']
				});

			if (await bcrypt.compare(password, passwordHash)) {
				// password matched
				const token = jwt.sign({ id: 'admin' }, env.JWT_SECRET_KEY as string);
				cookies.set('auth-token', token, {
					httpOnly: true,
					secure: false,
					sameSite: 'strict',
					path: '/',
					maxAge: 24 * 60 * 60 // retain for one day
				});
			} else {
				return fail(400, { errors: ['Incorrect password.'] });
			}

			return { success: true };
		} catch (error) {
			if (error instanceof ZodError) {
				// Password didn't meet minimum criteria
				const errors = error.issues.map((issue) => issue.message);
				console.error('[login.server.ts:actions.registerPassword] zod error:', error);
				return fail(400, { errors });
			}
			console.error('[login.server.ts:actions.registerPassword]', error);
			return fail(500, {
				errors: ['Internal failure. Check server logs for details.']
			});
		}
	}
};
