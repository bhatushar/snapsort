import { DateTime } from 'luxon';
import { removeDuplicatesPredicate } from '$lib/utility';
import path from 'path';
import fs, { mkdir } from 'fs/promises';
import {
	addFilesToLibrary,
	db,
	getPriorityOrderedFolderLabels,
	getQueuedFilesData
} from '$lib/server/db';
import { queuedFilesTable } from '$lib/server/db/schema';
import { eq } from 'drizzle-orm';
import { LIBRARY_ROOT_DIR } from '$env/static/private';

type PathRemap = {
	fileId: number;
	sourcePath: string;
	destinationPath: string;
};

type PathRemapFile = {
	id: number;
	path: string;
	captureDateTime: Date;
	mimeType: string;
	keywords: string[];
};

/**
 * Generates mappings for new file paths based on capture date and keywords. Doesn't move the files
 * to new locations.
 *
 * The new paths follow the following structure:
 *
 * `newRootPath/YYYY/MM - Month/DD[ - Folder Label]/[TAG]-YYYYMMDD-Index.ext`
 *
 * where:
 * - `YYYY` is the full-length year.
 * - `MM` is the number of the month (0-padded).
 * - `Month` is the full-name of the month.
 * - `DD` is the date of the month (0-padded).
 * - `TAG` is the tag of the file based on type (IMG for images, VID for videos) or keyword (EDT if Edit keyword).
 * - `Index` is the 3-digit per-tag index starting from 0.
 *
 * @param files Files to be remapped. Should be sorted in ascending order of capture time.
 * @param newRootPath The root directory path where remapped files will be placed.
 * @param sortedFolderLabels Array of folder label keywords sorted by priority (higher index = higher priority).
 * @returns Array of objects containing the original file path, new file path, and file ID for each remapped file.
 */
const remapFilePaths = (
	files: PathRemapFile[],
	newRootPath: string,
	sortedFolderLabels: string[]
): PathRemap[] => {
	// Get unique subdirectories in the format YYYY/MM - Month/DD
	const subDirs = files
		.map((file) => DateTime.fromJSDate(file.captureDateTime).toFormat('yyyy/MM - MMMM/dd'))
		.filter(removeDuplicatesPredicate);

	// Group the files by their target subdirectories
	const fileGroupsBySubDir = subDirs.map((subDir) => ({
		subDir,
		files: files.filter((file) => {
			const expectedSubDir = DateTime.fromJSDate(file.captureDateTime).toFormat(
				'yyyy/MM - MMMM/dd'
			);
			return expectedSubDir === subDir;
		})
	}));

	// Append labels to subdirectories based on the keywords present in the file
	const labelledSubDirGroups = fileGroupsBySubDir.map((group) => {
		let subDirLabel = '';
		let folderLabelIdx = -1;

		// Some files in a subdirectory may contain keywords which can be used as folder labels
		// Pick the keyword with the highest priority to use as the label
		group.files.forEach((file) => {
			const candidateLabelIdx = sortedFolderLabels.findIndex((label) =>
				file.keywords.includes(label)
			);
			if (folderLabelIdx < candidateLabelIdx) folderLabelIdx = candidateLabelIdx;
		});
		if (folderLabelIdx !== -1) {
			subDirLabel = ` - ${sortedFolderLabels[folderLabelIdx]}`;
		}

		return {
			subDir: group.subDir + subDirLabel,
			files: group.files
		};
	});

	// Generate new file names and create mappings to the new path
	const fileRemap = labelledSubDirGroups.flatMap((group) => {
		// Each tag has its own index
		const tagIndices = {
			IMG: 0,
			VID: 0,
			EDT: 0
		};

		return group.files.map((file) => {
			const captureDate = DateTime.fromJSDate(file.captureDateTime).toFormat('yyyyMMdd');
			let fileTag: 'IMG' | 'VID' | 'EDT';
			if (file.keywords.includes('Edit')) fileTag = 'EDT';
			else fileTag = file.mimeType.startsWith('image/') ? 'IMG' : 'VID';

			// Rename the file to TAG-YYYYMMDD-Index.ext format
			const newFileName =
				`${fileTag}-${captureDate}-${tagIndices[fileTag].toString().padStart(3, '0')}` +
				path.extname(file.path);
			tagIndices[fileTag]++;

			return {
				fileId: file.id,
				sourcePath: file.path,
				destinationPath: path.join(newRootPath, group.subDir, newFileName)
			};
		});
	});
	console.debug('[file-manager.ts:remapFilePaths] new paths:', fileRemap);

	return fileRemap;
};

/**
 * Asynchronously copies a list of files from their source paths to their respective destination paths.
 * Ensures all source files exist, creates necessary destination directories, and copies the files while preserving metadata.
 *
 * @param remaps - Array of objects mapping source file paths to destination file paths.
 * @throws Throws an error if any of the source files are missing.
 */
const copyFilesToDestination = async (remaps: PathRemap[]) => {
	// Ensure all source files are present in the disk
	const fileStats = await Promise.all(
		remaps.map(async ({ sourcePath }) => ({ path: sourcePath, stat: await fs.stat(sourcePath) }))
	);
	const missingFiles = fileStats.filter(({ stat }) => !stat.isFile()).map(({ path }) => path);
	if (missingFiles.length) throw new Error(`Copy failed. Missing source files: ${missingFiles}`);

	// Create destination directories
	const dirs = remaps
		.map(({ destinationPath }) => path.dirname(destinationPath))
		.filter(removeDuplicatesPredicate);

	await Promise.all(dirs.map((dir) => mkdir(dir, { recursive: true })));

	// Copy files with metadata
	await Promise.all(remaps.map(async (file) => fs.copyFile(file.sourcePath, file.destinationPath)));
};

/**
 * Delete queued files.
 * This includes removing the database entry, the uploaded file, and the generated thumbnail.
 *
 * @param fileIds IDs of files to be deleted
 * @returns Boolean indicating whether deletion is successful
 */
export const deleteQueuedFiles = async (fileIds: number[]): Promise<boolean> => {
	let isDeletionSuccessful = true;

	if (fileIds.length === 0) return isDeletionSuccessful;

	// Get paths associated with all the files
	const fileData = await getQueuedFilesData(fileIds);

	// Handle each file deletion separately
	// Failure in deleting one file should not affect other files
	await Promise.all(
		fileData.map(async (file) => {
			try {
				await db.transaction(async (tx) => {
					await tx.delete(queuedFilesTable).where(eq(queuedFilesTable.id, file.id));
					// Deleting the original before thumbnail, so that if a failure occurs,
					// the thumbnail can still be fetched to show the user
					if ((await fs.stat(file.path)).isFile()) await fs.rm(file.path);
					if ((await fs.stat(file.thumbnailPath)).isFile()) await fs.rm(file.thumbnailPath);
				});
			} catch (error) {
				console.error(`[index.server.ts:deleteFiles] failed to delete ${file.id}:`, error);
				isDeletionSuccessful = false;
			}
		})
	);

	return isDeletionSuccessful;
};

/**
 * Processes queued files by moving them to the library and updating the database.
 */
export const moveQueuedFilesToLibrary = async () => {
	const queuedFilesData = await getQueuedFilesData();
	const folderLabels = await getPriorityOrderedFolderLabels(
		queuedFilesData.flatMap(({ keywordIds }) => keywordIds).filter((kw) => kw !== null)
	);
	const remappedFilePaths = remapFilePaths(queuedFilesData, LIBRARY_ROOT_DIR, folderLabels);

	await copyFilesToDestination(remappedFilePaths);

	// Prepare database entries for new library files
	const newLibraryFiles = queuedFilesData.map((file) => {
		let newFilePath = remappedFilePaths.find((remap) => remap.fileId === file.id)
			?.destinationPath as string;
		const newFileName = path.basename(newFilePath);
		newFilePath = path.relative(LIBRARY_ROOT_DIR, path.dirname(newFilePath));

		return {
			...file,
			name: newFileName,
			path: newFilePath
		};
	});
	await addFilesToLibrary(newLibraryFiles);

	await deleteQueuedFiles(remappedFilePaths.map(({ fileId }) => fileId));
};
