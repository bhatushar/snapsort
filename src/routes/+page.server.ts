import type { Actions, PageServerLoad } from './$types';
import path from 'path';
import { fail } from '@sveltejs/kit';
import { z, ZodError } from 'zod';
import { applyExifMetadata, getExifMetadata } from '$lib/server/exiftool-wrapper';
import { database, type LibraryFileInput } from '$lib/server/db';
import {
	copyFilesToDestination,
	deleteFilesFromDisk,
	generateFileThumbnail,
	remapFilePaths,
	writeFileToDisk
} from '$lib/server/file-manager';
import type { CommittableQueuedFile, KeywordData, QueuedFileData } from '$lib/types';
import { removeDuplicatesPredicate } from '$lib/utility';
import ianaTz from '$lib/iana-tz.json';
import { DateTime } from 'luxon';
import { LIBRARY_ROOT_DIR } from '$env/static/private';

/* SECTION: Validation schemas */

/**
 * Schema to validate and transform a list of uploaded files.
 *
 * Validations:
 * - The list contains at least one file.
 * - Every file in the list has a size greater than 0 bytes.
 * - Each file type is either an image or a video based on its MIME type.
 *
 * Transformations:
 * - Converts the FileList object into an array of files for easier handling.
 */
const UploadedFileListSchema = z
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
 * Schema definition for validating and transforming the list of file IDs to be deleted.
 *
 * Validations:
 * - All file IDs are present in the database.
 *
 * Transformations:
 * - Filters out duplicate file IDs.
 * - Converts the input object into a list of IDs.
 */
const DeletedFileListSchema = z
	.object({
		ids: z
			.array(z.number())
			.transform((ids) => ids.filter(removeDuplicatesPredicate))
			// All IDs must be present in the database
			.refine(async (ids) => {
				if (ids.length === 0) return true;
				const fileCount = await database.queuedFiles.count(ids);
				return fileCount === ids.length;
			}, 'Unknown file ID(s) provided for deletion.')
	})
	.transform((files) => files.ids);

/**
 * Schema to validate and transform changes made to the media files.
 *
 * Input object validations:
 * - id: Unique file ID
 * - captureDate: Date of capture in 'yyyy-mm-dd' format
 * - captureTime: Time of capture in 'HH:MM:SS' format
 * - timezone: Timezone of capture
 * - title: Title of the file
 * - latitude: Latitude at which the file was taken
 * - longitude: Longitude at which the file was taken
 * - altitude: Altitude at which the file was taken
 * - keywordIds: IDs of keywords associated with the file
 *
 * Transformations:
 * - Merges captureDate and captureTime into a common JSDate object as captureDateTime.
 */
const QueuedFileUpdateSchema = z
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
			return (await database.queuedFiles.count([id])) === 1;
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

				const keywordsCount = await database.keywords.count(kw);
				return keywordsCount === kw.length;
			}, 'Provided keyword does not exist in the database.')
			// Each file should have at most one album/location keyword
			.refine(async (kw) => {
				if (kw.length === 0) return true;

				// Each file should have only one album/location keyword
				const result = await database.keywords.countByCategory(['Album', 'Location'], kw);
				return result.every(({ keywordCount }) => keywordCount <= 1);
			}, 'Multiple albums/locations specified for the same file.')
	})
	// If a location keyword is present, latitude/longitude should be specified
	.refine(async ({ keywordIds, latitude, longitude }) => {
		if (keywordIds.length === 0 || (latitude !== null && longitude !== null)) return true;

		const result = await database.keywords.countByCategory(['Location'], keywordIds);
		return result.length === 0 || result[0].keywordCount === 0;
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
 * Schema to validate changes made to a list of media files.
 *
 * This schema ensures that all items in the array conform to the
 * structure defined by {@link QueuedFileUpdateSchema}.
 *
 * Validations:
 * - Ensures all file IDs in the list are unique.
 */
const QueuedFileUpdateListSchema = z
	.array(QueuedFileUpdateSchema)
	// All IDs must be distinct
	.refine(
		(files) =>
			files.map((file) => file.id).filter(removeDuplicatesPredicate).length === files.length,
		'Duplicate files provided.'
	);

/**
 * Schema to validate and transform changes made to the media files being committed to the library.
 *
 * Uses {@link QueuedFileUpdateSchema} as the base structure and enforces stricter constraints on it.
 *
 * Validations:
 * - Ensures that the `captureDateTime` attribute is not null.
 * - Verifies that the `timezone` attribute is not null.
 * - Validates that both `latitude` and `longitude` are either specified together or neither is provided.
 * - Ensures that `altitude`, if specified, must be accompanied by both `latitude` and `longitude`.
 * - Requires that if `latitude` and `longitude` are specified, at least one location keyword must also be present.
 */
const CommittableQueuedFileSchema = QueuedFileUpdateSchema.refine(
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

		const result = await database.keywords.countByCategory(['Location'], keywordIds);
		return result.length === 1 && result[0].keywordCount === 1;
	}, 'Location keyword is missing for a file with GPS coordinates.');

/**
 * Schema to validate a list of files being committed to the library.
 *
 * Validations:
 * - The array must contain at least one file.
 * - All files within the array must have unique identifiers (no duplicate IDs allowed).
 */
const CommittableQueuedFileListSchema = z
	.array(CommittableQueuedFileSchema)
	.refine((files) => files.length > 0, 'No files provided.')
	.refine(
		(files) =>
			// All IDs must be distinct
			files.map((file) => file.id).filter(removeDuplicatesPredicate).length === files.length,
		'Duplicate files provided.'
	);

/* SECTION: Local functions */

/**
 * Handles upload of a new file. Generates a thumbnail, extracts exif data, and adds the file to DB.
 *
 * @param file
 * @return True if the file is successfully processed, false otherwise.
 */
const processUploadedFile = async (file: File): Promise<boolean> => {
	/*
	 Assign a new unique name to each uploaded file and store the files to the server
	 using new unique names. Use this file to get the exif info. Generate JPEG thumbnails
	 for image files and GIF thumbnails for video files. Save thumbnails with the same
	 unique name as the file. Add entries to the queue in DB.
	 In case of failure, delete the DB entry and delete the file from the server.
	 */
	let uploadedFilePath = '';
	let thumbnailPath = '';

	try {
		uploadedFilePath = await writeFileToDisk(file);
		thumbnailPath = await generateFileThumbnail(uploadedFilePath, file.type);

		// Get exif info
		const exifData = await getExifMetadata(uploadedFilePath);
		if (!exifData) {
			console.error(
				`[index.server.ts:processUploadedFile] Failed to extract Exif data for ${file.name}`
			);
			await deleteFilesFromDisk([uploadedFilePath, thumbnailPath]);
			return false;
		}
		console.debug('[index.server.ts:processUploadedFile] Exif data:', exifData);

		await database.queuedFiles.add({
			name: file.name,
			thumbnailPath,
			...exifData
		});
		return true;
	} catch (error) {
		console.error(`[index.server.ts:processUploadedFile] Processing ${file.name} failed:`, error);
		await deleteFilesFromDisk([uploadedFilePath, thumbnailPath]);
		return false;
	}
};

/**
 * Delete queued files.
 * This includes removing the database entry, the uploaded file, and the generated thumbnail.
 *
 * @param fileIds IDs of files to be deleted
 * @returns Boolean indicating whether deletion is successful
 */
const deleteQueuedFiles = async (fileIds: number[]): Promise<boolean> => {
	let isDeletionSuccessful = true;

	if (fileIds.length === 0) return isDeletionSuccessful;

	try {
		await database.queuedFiles.delete(fileIds);
	} catch (error) {
		console.error(`[file-manager.ts:deleteQueuedFiles] failed to delete files:`, error);
		isDeletionSuccessful = false;
	}

	return isDeletionSuccessful;
};

/**
 * Moves files from the queue to the library.
 *
 * This function:
 * 1. Retrieves folder labels for the files based on their keywords
 * 2. Remaps file paths according to library structure
 * 3. Copies files to their destination in library
 * 4. Creates database entries for the new library files
 * 5. Deletes the original queued files
 *
 * @param files - Files from the queue which are compatible with {@link LibraryFileInput} requirement.
 */
const moveQueuedFilesToLibrary = async (files: CommittableQueuedFile[]) => {
	const folderLabels = await database.keywords.getFolderLabels(
		files.flatMap(({ keywordIds }) => keywordIds)
	);
	const remappedFilePaths = remapFilePaths(files, LIBRARY_ROOT_DIR, folderLabels);

	await copyFilesToDestination(remappedFilePaths);

	// Prepare database entries for new library files
	const newLibraryFiles: LibraryFileInput[] = files.map((file) => {
		let newFilePath = remappedFilePaths.find((remap) => remap.fileId === file.id)
			?.destinationPath as string;
		const newFileName = path.basename(newFilePath);
		newFilePath = path.relative(LIBRARY_ROOT_DIR, path.dirname(newFilePath));

		return {
			name: newFileName,
			path: newFilePath,
			mimeType: file.mimeType,
			captureDateTime: file.captureDateTime,
			timezone: file.timezone,
			keywords: file.keywords,
			title: file.title,
			latitude: file.latitude,
			longitude: file.longitude,
			altitude: file.altitude
		};
	});
	await database.libraryFiles.add(newLibraryFiles);

	await deleteQueuedFiles(remappedFilePaths.map(({ fileId }) => fileId));
};

/* SECTION: Page load handler */

export const load: PageServerLoad = async (): Promise<{
	keywordCtx: KeywordData[];
	queuedFiles: QueuedFileData[];
}> => {
	const keywordCtx = await database.keywords.get();

	const queuedFiles = await database.queuedFiles.get();

	return { keywordCtx, queuedFiles };
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
			console.info(`[index.server.ts:actions.uploadFiles] ${parsedFiles.length} files uploaded`);
			// Process each file asynchronously
			const status = await Promise.all(parsedFiles.map(processUploadedFile));

			return {
				messages: [`${status.filter((status) => status).length} file(s) uploaded successfully.`]
			};
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
			const parsedFileChanges = await QueuedFileUpdateListSchema.parseAsync(fileChanges);
			const parsedDeletedFiles = await DeletedFileListSchema.parseAsync(deletedFiles);

			console.debug('[index.server.ts:actions.modifyFiles] file changes:', parsedFileChanges);
			console.debug('[index.server.ts:actions.modifyFiles] deleted files:', parsedDeletedFiles);

			if (!(await deleteQueuedFiles(parsedDeletedFiles))) {
				return fail(500, {
					errors: ['File deletion was unsuccessful.']
				});
			}

			await database.queuedFiles.update(parsedFileChanges);

			return {
				messages: [
					`${parsedFileChanges.length} file(s) modified.`,
					`${parsedDeletedFiles.length} file(s) removed.`
				]
			};
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
			const parsedFileChanges = await CommittableQueuedFileListSchema.parseAsync(fileChanges);
			const parsedDeletedFiles = await DeletedFileListSchema.parseAsync(deletedFiles);

			console.debug('[index.server.ts:actions.commitFiles] file changes:', parsedFileChanges);
			console.debug('[index.server.ts:actions.commitFiles] deleted files:', parsedDeletedFiles);

			if (!(await deleteQueuedFiles(parsedDeletedFiles))) {
				return fail(500, {
					errors: ['File deletion was unsuccessful.']
				});
			}

			// After applying changes, queued files will be compatible with the library file format
			await database.queuedFiles.update(parsedFileChanges);
			const committableFiles = (await database.queuedFiles.get()) as CommittableQueuedFile[];
			console.debug(
				'[index.server.ts:actions.commitFiles] queued file ready to commit:',
				committableFiles
			);

			// Apply Exif data to the queued files
			if (!(await applyExifMetadata(committableFiles))) {
				return fail(500, {
					errors: ['Failed to write Exif data to file(s)']
				});
			}

			await moveQueuedFilesToLibrary(committableFiles);

			return {
				messages: [
					`Successfully moved ${committableFiles.length} file(s) to library.`,
					`${parsedDeletedFiles.length} file(s) removed.`
				]
			};
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
