import { type Actions, fail } from '@sveltejs/kit';
import { ZodError } from 'zod';
import bcrypt from 'bcrypt';
import { database } from '$lib/server/db';
import { PasswordSchema } from '$lib/server/validation-schema';

export const actions: Actions = {
	// Update login password
	changePassword: async ({ request }) => {
		try {
			const formData = await request.formData();
			const oldPassword = PasswordSchema.parse(formData.get('oldPassword'));
			const newPassword = PasswordSchema.parse(formData.get('newPassword'));

			const oldPasswordHash = await database.auth.getLoginPassword();
			if (!oldPasswordHash)
				// We should not hit this
				return fail(400, { errors: ['No password registered.'] });

			if (await bcrypt.compare(oldPassword, oldPasswordHash)) {
				// Old password matched
				if (oldPassword === newPassword)
					return fail(400, { errors: ['New password cannot be the same as current password.'] });

				const saltRounds = 10;
				const newPasswordHash = await bcrypt.hash(newPassword, saltRounds);
				await database.auth.setLoginPassword(newPasswordHash);

				return { success: true, messages: ['Password successfully updated'] };
			} else {
				return fail(400, { errors: ['Current password did not match.'] });
			}
		} catch (error) {
			if (error instanceof ZodError) {
				// Password didn't meet minimum criteria
				const errors = error.issues.map((issue) => issue.message);
				console.error('[change-password.server.ts:actions.changePassword] zod error:', error);
				return fail(400, { errors });
			}
			console.error('[change-password.server.ts:actions.changePassword]', error);
			return fail(500, {
				errors: ['Internal failure. Check server logs for details.']
			});
		}
	}
};
