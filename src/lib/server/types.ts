import { z } from 'zod';
import { db } from '$lib/server/db';
import { keywordsTable, queuedFilesTable } from '$lib/server/db/schema';
import { and, count, eq, inArray, or } from 'drizzle-orm';
import ianaTz from '$lib/iana-tz.json';
import { removeDuplicatesPredicate } from '$lib/utility';
import { DateTime } from 'luxon';

export const UploadedFileListSchema = z
	.custom<FileList>()
	.refine((files) => files.length > 0, 'No file uploaded')
	.refine((files) => Array.from(files).every((file) => file.size > 0), 'Invalid file size')
	.refine(
		(files) =>
			Array.from(files).every(
				(file) => file.type.startsWith('image/') || file.type.startsWith('video/')
			),
		'Selected file is not a valid image/video'
	)
	.transform((files) => Array.from(files));

/**
 * Schema representing a list of files to be deleted.
 *
 * Input format: { ids: number[] }
 * Output format: number[]
 */
export const DeletedFileListSchema = z
	.object({
		ids: z
			.array(z.number())
			.transform((ids) => ids.filter(removeDuplicatesPredicate))
			// All IDs must be present in the database
			.refine(async (ids) => {
				const result = await db
					.select({ count: count(queuedFilesTable.id) })
					.from(queuedFilesTable)
					.where(inArray(queuedFilesTable.id, ids));
				return result[0].count === ids.length;
			}, 'Unknown file ID(s) provided.')
	})
	.transform((files) => files.ids);

/**
 * Schema representing modifications made to a file.
 *
 * Properties:
 * - id: Unique file ID
 * - captureDate: Date of capture in 'yyyy-mm-dd' format
 * - captureTime: Time of capture in 'HH:MM:SS' format
 * - timezone: Timezone of capture
 * - title: Title of the file
 * - latitude: Latitude at which the file was taken
 * - longitude: Longitude at which the file was taken
 * - altitude: Altitude at which the file was taken
 * - keywordIds: IDs of keywords associated with the file
 */
export const ModifiedFileSchema = z
	.object({
		id: z.number().refine(async (id) => {
			// Queued file must exist in the database
			/*
			 * PERFORMANCE NOTE:
			 * This implementation is not optimal because it queries the database for every file separately.
			 * Instead, it can be done with one query for aggregated IDs of all files.
			 * However, I'm keeping this here just because semantically it makes more sense. If any
			 * performance issues are observed, then this can be moved.
			 */
			const result = await db
				.select({ id: queuedFilesTable.id })
				.from(queuedFilesTable)
				.where(eq(queuedFilesTable.id, id));
			return result[0].id === id;
		}, 'Unknown file ID(s) provided.'),
		captureDate: z.string().date().nullable(), // Date will be in 'yyyy-mm-dd' format
		captureTime: z
			.string()
			.time({ message: 'Incorrect value provided for time.' })
			.regex(/^\d{2}:\d{2}:\d{2}$/, 'Time is expected in HH:MM:SS format.') // Time should include seconds
			.nullable(),
		timezone: z
			.string()
			.refine(
				(tz) => ianaTz.some((ianaTz) => ianaTz.zone === tz),
				'Provided timezone does not exist'
			)
			.nullable(),
		title: z.string().nullable(),
		latitude: z.number().min(-90).max(90).nullable(),
		longitude: z.number().min(-180).max(180).nullable(),
		altitude: z.number().nullable(),
		keywordIds: z
			.array(z.number())
			.transform((kw) => kw.filter(removeDuplicatesPredicate))
			// All keywords must be present in the database
			.refine(async (kw) => {
				/*
				 * PERFORMANCE NOTE:
				 * This implementation is not optimal because it queries the database for every file separately.
				 * Instead, it can be done with one query for aggregated keywords of all files.
				 * However, I'm keeping this here just because semantically it makes more sense. If any
				 * performance issues are observed, then this can be moved.
				 */
				if (kw.length === 0) return true;

				const result = await db
					.select({ count: count(keywordsTable.id) })
					.from(keywordsTable)
					.where(inArray(keywordsTable.id, kw));
				return result[0].count === kw.length;
			}, 'Provided keyword does not exist in the database.')
			// Each file should have at most one album/location keyword
			.refine(async (kw) => {
				if (kw.length === 0) return true;

				// Each file should have only one album/location keyword
				const result = await db
					.select({ category: keywordsTable.category, count: count(keywordsTable.id) })
					.from(keywordsTable)
					.where(
						and(
							inArray(keywordsTable.id, kw),
							or(eq(keywordsTable.category, 'Album'), eq(keywordsTable.category, 'Location'))
						)
					)
					.groupBy(keywordsTable.category);
				return result.every(({ count }) => count <= 1);
			}, 'Multiple albums/locations specified for the same file.')
	})
	// If a location keyword is present, latitude/longitude should be specified
	.refine(async ({ keywordIds, latitude, longitude }) => {
		if (keywordIds.length === 0 || (latitude !== null && longitude !== null)) return true;

		const result = await db
			.select({ count: count(keywordsTable.id) })
			.from(keywordsTable)
			.where(and(inArray(keywordsTable.id, keywordIds), eq(keywordsTable.category, 'Location')));

		return result[0].count === 0;
	}, 'GPS coordinates are missing for file(s) with location keyword.')
	// Partial datetime is not allowed
	.refine(
		({ captureDate, captureTime }) =>
			(captureDate && captureTime) || (!captureDate && !captureTime),
		'Both date and time must be specified.'
	)
	// Convert date and time input into JS Date
	.transform(({ captureDate, captureTime, timezone, ...rest }) => {
		if (!captureDate || !captureTime) return { captureDateTime: null, timezone, ...rest };

		// Combine date and time into a common attribute, compatible with the database.
		const datetime = DateTime.fromFormat(`${captureDate} ${captureTime}`, 'yyyy-MM-dd HH:mm:ss', {
			zone: timezone ?? undefined
		});
		return {
			...rest,
			timezone,
			captureDateTime: datetime.toJSDate()
		};
	})
	// Date must be in the past
	.refine(
		({ captureDateTime }) => !captureDateTime || captureDateTime.getTime() <= Date.now(),
		'File date is in the future'
	);

/**
 * Schema representing a list of files to be modified.
 */
export const ModifiedFileListSchema = z
	.array(ModifiedFileSchema)
	// All IDs must be distinct
	.refine(
		(files) =>
			files.map((file) => file.id).filter(removeDuplicatesPredicate).length === files.length,
		'Duplicate files provided.'
	);

export const CommittedFileSchema = ModifiedFileSchema.refine(
	({ captureDateTime }) => captureDateTime !== null,
	'Date/Time is missing.'
)
	.refine(({ timezone }) => timezone !== null, 'Timezone is missing.')
	.refine(
		({ latitude, longitude }) =>
			(latitude !== null && longitude !== null) || (latitude === null && longitude === null),
		'Both latitude and longitude must be specified or neither should be specified.'
	)
	.refine(
		// Altitude is optional but should always be accompanied by latitude and longitude
		({ latitude, altitude }) => !(latitude === null && altitude !== null),
		'Partial GPS coordinates specified.'
	)
	.refine(async ({ keywordIds, latitude }) => {
		/*
		 * Base schema already ensures that if a location keyword is present, then the latitude/longitude
		 * must be specified. Now, check the inverse. If latitude/longitude are specified, then a
		 * location keyword must be present.
		 */
		if (latitude === null) return true; // No GPS coordinates specified

		if (keywordIds.length === 0) return false;

		const result = await db
			.select({ count: count(keywordsTable.id) })
			.from(keywordsTable)
			.where(and(inArray(keywordsTable.id, keywordIds), eq(keywordsTable.category, 'Location')));

		return result[0].count > 0;
	}, 'Location keyword is missing for a file with GPS coordinates.');

export const CommittedFileListSchema = z
	.array(CommittedFileSchema)
	.refine((files) => files.length > 0, 'No files provided.')
	.refine(
		(files) =>
			// All IDs must be distinct
			files.map((file) => file.id).filter(removeDuplicatesPredicate).length === files.length,
		'Duplicate files provided.'
	);
