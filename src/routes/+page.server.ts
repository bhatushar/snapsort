import type { Actions, PageServerLoad } from './$types';
import path from 'path';
import fs, { writeFile } from 'fs/promises';
import { fail } from '@sveltejs/kit';
import { z, ZodError } from 'zod';
import { FILE_UPLOAD_DIR } from '$env/static/private';
import {
	type ExifWriteableDataSimplified,
	readSimplifiedExifProps,
	writeSimplifiedExifProps
} from '$lib/server/exiftool-wrapper';
import { imageThumbnail, videoToGif } from '$lib/server/utility';
import { db } from '$lib/server/db';
import {
	citiesTable,
	countriesTable,
	keywordsTable,
	locationsTable,
	queuedFilesTable,
	queuedFilesToKeywordsTable,
	statesTable
} from '$lib/server/db/schema';
import { DateTime } from 'luxon';
import { and, eq, inArray, not, sql } from 'drizzle-orm';
import type { IndexPageResponse, QueuedFileData } from '$lib/types';
import {
	CommittedFileListSchema,
	DeletedFileListSchema,
	ModifiedFileListSchema,
	UploadedFileListSchema
} from '$lib/server/types';
import ianaTz from '$lib/iana-tz.json';
import { deleteQueuedFiles, moveQueuedFilesToLibrary } from '$lib/server/file-manager';

/* SECTION: Local functions */

/**
 * Handles upload of a new file. Generates a thumbnail, extracts exif data, and adds the file to DB.
 *
 * @param file
 */
const processIndividualUploadedFile = async (file: File) => {
	/*
	 Assign a new unique name to each uploaded file and store the files to the server
	 using new unique names. Use this file to get the exif info. Generate JPEG thumbnails
	 for image files and GIF thumbnails for video files. Save thumbnails with the same
	 unique name as the file. Add entries to the queue in DB.
	 In case of failure, delete the DB entry and delete the file from the server.
	 */
	const newFileName = crypto.randomUUID().toString();
	const fileExt = path.extname(file.name);
	const thumbExt = file.type.startsWith('image/') ? '.jpg' : '.gif';
	const filePath = path.join(FILE_UPLOAD_DIR, newFileName + fileExt);
	const thumbPath = path.join(FILE_UPLOAD_DIR, 'thumb', newFileName + thumbExt);

	try {
		// Write files to server
		const fileBuffer = Buffer.from(await file.arrayBuffer());
		await writeFile(filePath, fileBuffer);
		console.debug('[index.server.ts:processIndividualUploadedFile] file written:', filePath);

		// Generate thumbnail
		if (file.type.startsWith('image/')) await imageThumbnail(fileBuffer, thumbPath);
		else await videoToGif(filePath, thumbPath);
		console.debug('[index.server.ts:processIndividualUploadedFile] thumbnail written:', thumbPath);

		// Get exif info
		const exifData = await readSimplifiedExifProps(filePath, [
			'MIMEType',
			'DateTimeCreated',
			'OffsetTime',
			'Title',
			'Keywords',
			'GPSLatitude',
			'GPSLongitude',
			'GPSAltitude'
		]);
		if (!exifData) throw new Error('Exif extraction failed');
		console.debug('[index.server.ts:processIndividualUploadedFile] Exif data:', exifData);

		/*
		 * HotFix for extracting timezone from Exif offset:
		 * If the current timezone matches the Exif offset, use the current timezone.
		 * Otherwise, find the first timezone which matches the Exif offset.
		 */
		let zoneName = DateTime.now().zoneName;
		if (exifData.OffsetTime) {
			if (!ianaTz.some((tz) => tz.zone === zoneName && tz.utcOffset.std === exifData.OffsetTime)) {
				// The current timezone does not match the Exif offset present in the file
				// Find the first timezone which matches the Exif offset
				const tz = ianaTz.find((tz) => tz.utcOffset.std === exifData.OffsetTime);
				if (tz) zoneName = tz.zone;
			}
		}

		await db.transaction(async (tx) => {
			// Append the new file to the database queue
			const [{ fileId }] = await tx
				.insert(queuedFilesTable)
				.values({
					name: file.name,
					path: filePath,
					thumbnailPath: thumbPath,
					mimeType: exifData.MIMEType,
					captureDateTime: exifData.DateTime ?? null,
					timezone: zoneName,
					title: exifData.Title ?? null,
					latitude: exifData.GPSLatitude ?? null,
					longitude: exifData.GPSLongitude ?? null,
					altitude: exifData.GPSAltitude ?? null
				})
				.returning({ fileId: queuedFilesTable.id });

			// Append related keywords to the database if the uploaded file has existing keywords
			if (exifData.Keywords?.length) {
				const keywordIds = await tx
					.select({ keywordId: keywordsTable.id })
					.from(keywordsTable)
					.where(inArray(keywordsTable.keyword, exifData.Keywords));

				if (keywordIds.length) {
					await tx
						.insert(queuedFilesToKeywordsTable)
						.values(keywordIds.map(({ keywordId }) => ({ fileId, keywordId })));
				} else {
					console.warn(
						`[index.server.ts:processIndividualUploadedFile]${file.name} has unknown keywords:`,
						exifData.Keywords
					);
				}
			}
		});
	} catch (error) {
		console.error(
			`[index.server.ts:processIndividualUploadedFile] Processing ${file.name} failed:`,
			error
		);

		if ((await fs.stat(filePath)).isFile()) {
			// Failed after writing the file to server, delete it
			await fs.rm(filePath);
		}

		if ((await fs.stat(thumbPath)).isFile()) {
			// Failed after writing the thumbnail to server, delete it
			await fs.rm(thumbPath);
		}
	}
};

/**
 * Update file metadata in the database with the new changes.
 *
 * @param fileChanges
 */
const updateFilesData = async (fileChanges: z.infer<typeof ModifiedFileListSchema>) => {
	if (fileChanges.length === 0) return;

	const fileKeywordPairs = fileChanges.flatMap((file) =>
		file.keywordIds.flatMap((kw) => ({ fileId: file.id, keywordId: kw }))
	);

	await db.transaction(async (tx) => {
		await Promise.all([
			// Update file metadata
			...fileChanges.map(async (file) =>
				tx.update(queuedFilesTable).set(file).where(eq(queuedFilesTable.id, file.id))
			),
			// Delete mappings for keywords removed by the user
			...fileChanges.map(async (file) =>
				tx
					.delete(queuedFilesToKeywordsTable)
					.where(
						and(
							eq(queuedFilesToKeywordsTable.fileId, file.id),
							not(inArray(queuedFilesToKeywordsTable.keywordId, file.keywordIds))
						)
					)
			),
			// Add new keywords, if any
			fileKeywordPairs.length &&
				tx.insert(queuedFilesToKeywordsTable).values(fileKeywordPairs).onConflictDoNothing()
		]);
	});
};

/* SECTION: Page load handler */

export const load: PageServerLoad = async (): Promise<IndexPageResponse> => {
	const keywordCtx = await db
		.select({
			id: keywordsTable.id,
			name: keywordsTable.keyword,
			category: keywordsTable.category,
			city: citiesTable.name,
			state: statesTable.name,
			country: countriesTable.name,
			latitude: locationsTable.latitude,
			longitude: locationsTable.longitude,
			altitude: locationsTable.altitude
		})
		.from(keywordsTable)
		.leftJoin(locationsTable, eq(keywordsTable.locationId, locationsTable.id))
		.leftJoin(citiesTable, eq(locationsTable.cityId, citiesTable.id))
		.leftJoin(statesTable, eq(locationsTable.stateId, statesTable.id))
		.leftJoin(countriesTable, eq(locationsTable.countryId, countriesTable.id));

	const queuedFileRows = await db
		.select({
			id: queuedFilesTable.id,
			name: queuedFilesTable.name,
			path: queuedFilesTable.thumbnailPath,
			captureDateTime: queuedFilesTable.captureDateTime,
			timezone: queuedFilesTable.timezone,
			title: queuedFilesTable.title,
			latitude: queuedFilesTable.latitude,
			longitude: queuedFilesTable.longitude,
			altitude: queuedFilesTable.altitude,
			keywordIds: sql`array_agg(${queuedFilesToKeywordsTable.keywordId} ORDER BY ${keywordsTable.category}, ${keywordsTable.keyword})`
		})
		.from(queuedFilesTable)
		.leftJoin(
			queuedFilesToKeywordsTable,
			eq(queuedFilesTable.id, queuedFilesToKeywordsTable.fileId)
		)
		.leftJoin(keywordsTable, eq(queuedFilesToKeywordsTable.keywordId, keywordsTable.id))
		.groupBy(queuedFilesTable.id)
		.orderBy(queuedFilesTable.captureDateTime);

	const queuedFilesData: QueuedFileData[] = queuedFileRows.map(
		({ path: filePath, captureDateTime, timezone, keywordIds, ...rest }) => {
			let captureDate: string | null = null;
			let captureTime: string | null = null;

			if (captureDateTime) {
				const parsedDateTime = timezone
					? DateTime.fromJSDate(captureDateTime).setZone(timezone)
					: DateTime.fromJSDate(captureDateTime);
				captureDate = parsedDateTime.toFormat('yyyy-MM-dd');
				captureTime = parsedDateTime.toFormat('HH:mm:ss');
			}

			return {
				path: path.relative(process.cwd(), filePath),
				keywordIds: (keywordIds as (number | null)[]).filter((id: number | null) => id !== null),
				captureDate,
				captureTime,
				timezone,
				...rest
			};
		}
	);

	return { keywordCtx, queuedFilesData };
};

/* SECTION: Action handlers */

export const actions: Actions = {
	// File upload action
	uploadFiles: async ({ request }) => {
		try {
			const formData = await request.formData();
			const uploadedFiles = formData.getAll('uploadedFiles');
			console.debug('[index.server.ts:actions.uploadFiles] uploaded files:', uploadedFiles);
			const parsedFiles = UploadedFileListSchema.parse(uploadedFiles);
			// Process each file asynchronously
			await Promise.all(parsedFiles.map(processIndividualUploadedFile));
			return { success: true };
		} catch (error) {
			if (error instanceof ZodError) {
				// File validation failed
				const errors = error.issues.map((issue) => issue.message);
				console.error('[index.server.ts:actions.uploadFiles] zod error:', error);
				return fail(400, { errors });
			}
			console.error('[index.server.ts:actions.uploadFiles]', error);
			return fail(500, {
				errors: ['Internal failure. Check server logs for details.']
			});
		}
	},
	// Modify files on the server
	modifyFiles: async ({ request }) => {
		try {
			const formData = await request.formData();
			const fileChanges = JSON.parse(formData.getAll('fileChanges').toString());
			const deletedFiles = JSON.parse(formData.getAll('deletedFiles').toString());
			const parsedFileChanges = await ModifiedFileListSchema.parseAsync(fileChanges);
			const parsedDeletedFiles = await DeletedFileListSchema.parseAsync(deletedFiles);

			console.debug('[index.server.ts:actions.modifyFiles] file changes:', parsedFileChanges);
			console.debug('[index.server.ts:actions.modifyFiles] deleted files:', parsedDeletedFiles);

			const isDeletionSuccessful = await deleteQueuedFiles(parsedDeletedFiles);
			await updateFilesData(parsedFileChanges);

			if (!isDeletionSuccessful) throw new Error('Unable to delete files.');
		} catch (error) {
			if (error instanceof ZodError) {
				const errors = error.issues.map((issue) => issue.message);
				console.error('[index.server.ts:actions.modifyFiles] zod error:', error);
				return fail(400, { errors });
			}
			console.error('[index.server.ts:actions.modifyFiles]', error);
			return fail(500, {
				errors: ['Internal failure. Check server logs for details.']
			});
		}
	},
	// Save changes and move files to the library
	commitFiles: async ({ request }) => {
		try {
			const formData = await request.formData();
			const fileChanges = JSON.parse(formData.getAll('fileChanges').toString());
			const deletedFiles = JSON.parse(formData.getAll('deletedFiles').toString());
			const parsedFileChanges = await CommittedFileListSchema.parseAsync(fileChanges);
			const parsedDeletedFiles = await DeletedFileListSchema.parseAsync(deletedFiles);

			console.debug('[index.server.ts:actions.commitFiles] file changes:', parsedFileChanges);
			console.debug('[index.server.ts:actions.commitFiles] deleted files:', parsedDeletedFiles);

			await deleteQueuedFiles(parsedDeletedFiles);
			await updateFilesData(parsedFileChanges);

			// Apply Exif data to the queued files
			const queuedFileData: ExifWriteableDataSimplified[] = (await db
				.select({
					path: queuedFilesTable.path,
					mimeType: queuedFilesTable.mimeType,
					captureDateTime: queuedFilesTable.captureDateTime,
					timezone: queuedFilesTable.timezone,
					title: queuedFilesTable.title,
					latitude: queuedFilesTable.latitude,
					longitude: queuedFilesTable.longitude,
					altitude: queuedFilesTable.altitude,
					keywords: sql`array_agg(${keywordsTable.keyword})`
				})
				.from(queuedFilesTable)
				.leftJoin(
					queuedFilesToKeywordsTable,
					eq(queuedFilesTable.id, queuedFilesToKeywordsTable.fileId)
				)
				.leftJoin(keywordsTable, eq(queuedFilesToKeywordsTable.keywordId, keywordsTable.id))
				.groupBy(queuedFilesTable.id)) as ExifWriteableDataSimplified[];
			console.debug('[index.server.ts:actions.commitFiles] queued file data:', queuedFileData);
			if (!(await writeSimplifiedExifProps(queuedFileData)))
				throw new Error('Failed to write Exif data to file(s)');

			await moveQueuedFilesToLibrary();
			return { success: true };
		} catch (error) {
			if (error instanceof ZodError) {
				const errors = error.issues.map((issue) => issue.message);
				console.error('[index.server.ts:actions.commitFiles] zod error:', error);
				return fail(400, { errors });
			}
			console.error('[index.server.ts:actions.commitFiles]', error);
			return fail(500, {
				errors: ['Internal failure. Check server logs for details.']
			});
		}
	}
} satisfies Actions;
