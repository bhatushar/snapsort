import type { Actions, PageServerLoad } from './$types';
import { database } from '$lib/server/db';
import { z, ZodError } from 'zod';
import { fail } from '@sveltejs/kit';
import { NonLocationKeywordCategories } from '$lib/types';

/**
 * Schema for validating the new keyword being added by the user.
 *
 * Fields:
 * - `keyword`: Unique name of the keyword.
 * - `category`: Keyword category, refer {@link KeywordCategory}.
 * - `isFolderLabel`: Indicates whether keyword can be used to label file's parent folder.
 * - `city`: Optional name of the city, if category is 'Location'.
 * - `state`: Optional name of the state, if category is 'Location'.
 * - `country`: Name of the country, if category is 'Location'.
 * - `latitude`: GPS latitude, if the category is 'Location'.
 * - `longitude`: GPS longitude, if the category is 'Location'.
 * - `altitude`: Optional GPS altitude, if the category is 'Location'.
 */
const KeywordInputSchema = z
	.object({
		keyword: z
			.string()
			.min(1, 'Keyword cannot be empty')
			.refine(async (value) => {
				const existingKeyword = await database.keywords.get([value]);
				return existingKeyword.length === 0;
			}, 'Keyword already exists.'),
		isFolderLabel: z.coerce.boolean()
	})
	.and(
		z
			.discriminatedUnion('category', [
				z.object({ category: z.enum(NonLocationKeywordCategories) }),
				z.object({
					category: z.literal('Location'),
					city: z.string().nullable(),
					state: z.string().nullable(),
					country: z.string(),
					latitude: z.string().min(1, 'Latitude cannot be empty'),
					longitude: z.string().min(1, 'Longitude cannot be empty'),
					altitude: z.string().nullable()
				})
			])
			// Cannot perform transformations or refinements inside discriminated union
			.transform((data) => {
				// Convert latitude, longitude and altitude to numbers
				// Cannot coerce directly because zod converts empty string to 0
				if (data.category === 'Location') {
					return {
						...data,
						latitude: parseFloat(data.latitude),
						longitude: parseFloat(data.longitude),
						altitude:
							data.altitude !== null && data.altitude !== '' ? parseFloat(data.altitude) : null
					};
				}
				return data;
			})
			.refine(
				(data) => data.category !== 'Location' || (-90 <= data.latitude && data.latitude <= 90),
				'Latitude must be between -90 and 90.'
			)
			.refine(
				(data) => data.category !== 'Location' || (-180 <= data.longitude && data.longitude <= 180),
				'Longitude must be between -180 and 180.'
			)
			.refine(
				(data) => data.category !== 'Location' || data.altitude === null || !isNaN(data.altitude),
				'Altitude must be a number.'
			)
			.refine(
				(data) => data.category !== 'Location' || data.state || !data.city,
				'City should only be set if state is provided.'
			)
	);

export const load: PageServerLoad = async () => {
	const [keywords, cities, states, countries] = await Promise.all([
		database.keywords.get(),
		database.locations.getCities(),
		database.locations.getStates(),
		database.locations.getCountries()
	]);
	return { keywords, locations: { cities, states, countries } };
};

export const actions: Actions = {
	// Add a new keyword
	addKeyword: async ({ request }) => {
		try {
			const formData = await request.formData();
			const rawData = {
				keyword: formData.get('keyword'),
				category: formData.get('category'),
				isFolderLabel: formData.get('isFolderLabel'),
				city: formData.get('city'),
				state: formData.get('state'),
				country: formData.get('country'),
				latitude: formData.get('latitude'),
				longitude: formData.get('longitude'),
				altitude: formData.get('altitude')
			};
			const keywordData = await KeywordInputSchema.parseAsync(rawData);
			console.debug('[manage-keywords.server.ts:actions.addKeyword] keyword data:', keywordData);
			await database.keywords.add(keywordData);
			return { messages: [`Successfully added new keyword: ${keywordData.keyword}`] };
		} catch (error) {
			if (error instanceof ZodError) {
				const errors = error.issues.map((issue) => issue.message);
				console.error('[manage-keywords.server.ts:actions.addKeyword] zod error:', error);
				return fail(400, { errors });
			}
			console.error('[manage-keywords.server.ts:actions.addKeyword]', error);
			return fail(500, {
				errors: ['Internal failure. Check server logs for details.']
			});
		}
	}
};
