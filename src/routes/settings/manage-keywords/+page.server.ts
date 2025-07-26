import type { Actions, PageServerLoad } from './$types';
import { addKeyword, getCities, getCountries, getKeywords, getStates } from '$lib/server/db';
import { z, ZodError } from 'zod';
import { fail } from '@sveltejs/kit';

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
const IncomingKeywordSchema = z
	.object({
		keyword: z
			.string()
			.min(1, 'Keyword cannot be empty.')
			.refine(async (value) => {
				const result = await getKeywords([value]);
				return result.length === 0;
			}, 'Keyword already exists.'),
		category: z.enum(['Album', 'Group', 'Location', 'Person', 'Animal', 'Other']),
		isFolderLabel: z
			.enum(['on', 'off'])
			.nullable()
			.transform((value) => value === 'on'),
		city: z
			.string()
			.nullable()
			.transform((value) => (value?.length ? value : null)),
		state: z
			.string()
			.nullable()
			.transform((value) => (value?.length ? value : null)),
		country: z
			.string()
			.nullable()
			.transform((value) => (value?.length ? value : null)),
		latitude: z
			.string()
			.nullable()
			.transform((value) => (value?.length ? parseInt(value) : null))
			.refine(
				(value) => value === null || (-90 <= value && value <= 90),
				'Latitude must be in range -90 to 90.'
			),
		longitude: z
			.string()
			.nullable()
			.transform((value) => (value?.length ? parseInt(value) : null))
			.refine(
				(value) => value === null || (-180 <= value && value <= 180),
				'Longitude must be in range -180 to 180.'
			),
		altitude: z
			.string()
			.nullable()
			.transform((value) => (value?.length ? parseInt(value) : null))
	})
	.refine(
		({ category, city, state, country }) =>
			category === 'Location' || (!city && !state && !country),
		"City/State/Country should only be defined for keywords with 'Location' category."
	)
	.refine(
		({ category, country }) => category !== 'Location' || country,
		'Country must be specified for a location.'
	)
	.refine(
		({ category, city, state }) => category !== 'Location' || state || !city,
		'City should only be set if state is provided.'
	)
	.refine(
		({ category, latitude, longitude, altitude }) =>
			category === 'Location' || (latitude === null && longitude === null && altitude === null),
		"GPS Coordinates don't apply to non-location keywords."
	)
	.refine(
		({ category, latitude, longitude }) =>
			category !== 'Location' || (latitude !== null && longitude !== null),
		'Latitude/Longitude must be specified for a location.'
	);

/**
 * Type definition for the new keyword being added by the user.
 *
 * This is defined explicitly to provide stricter typing for GPS information, but it should remain
 * in sync with {@link IncomingKeywordSchema}.
 */
export type IncomingKeyword =
	| {
			keyword: string;
			category: 'Album' | 'Group' | 'Person' | 'Animal' | 'Other';
			isFolderLabel: boolean;
			locationId: null;
	  }
	| {
			keyword: string;
			category: 'Location';
			isFolderLabel: boolean;
			city: string | null;
			state: string | null;
			country: string;
			latitude: number;
			longitude: number;
			altitude: number | null;
	  };

export const load: PageServerLoad = async () => {
	const [keywords, cities, states, countries] = await Promise.all([
		getKeywords(),
		getCities(),
		getStates(),
		getCountries()
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
			const keywordData = (await IncomingKeywordSchema.parseAsync(rawData)) as IncomingKeyword;
			console.debug('[manage-keywords.server.ts:actions.addKeyword] keyword data:', keywordData);
			await addKeyword(keywordData);
			return { success: true };
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
