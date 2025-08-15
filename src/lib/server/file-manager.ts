import { DateTime } from 'luxon';
import { removeDuplicatesPredicate } from '$lib/utility';
import path from 'path';
import fs from 'fs/promises';
import { FFMPEG_PATH, FILE_UPLOAD_DIR } from '$env/static/private';
import sharp from 'sharp';
import { execPromise } from '$lib/server/utility';

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

type ImageThumbnailOpts = {
	width: number;
};

type VideoThumbnailOpts = {
	fps: number;
	width: number;
};

/**
 * Generate a JPEG thumbnail from an image file.
 *
 * @param imgPath Path to source image.
 * @param outPath Path to thumbnail output.
 * @param opts Options to control output parameters.
 * @throws Error If thumbnail generation fails.
 */
async function imageThumbnail(
	imgPath: string,
	outPath: string,
	opts: ImageThumbnailOpts = { width: 320 }
) {
	// Disable cache so that sharp releases lock on the source file
	sharp.cache(false);

	await sharp(imgPath)
		.resize(opts.width)
		.withMetadata() // Preserve metadata for correct orientation
		.jpeg()
		.toFile(outPath);
}

/**
 * Generate a GIF thumbnail from a video file.
 *
 * @param videoPath Path to source video.
 * @param outPath Path to thumbnail output.
 * @param opts Options to control output parameters.
 * @throws Error If GIF generation fails.
 */
async function videoToGif(
	videoPath: string,
	outPath: string,
	opts: VideoThumbnailOpts = { fps: 3, width: 200 }
) {
	if (!FFMPEG_PATH) {
		throw new Error('FFMPEG not found.');
	}

	/*
		Use ffmpeg to generate a GIF from a video with following parameters:
		- fps sets the frame rate.
		- scale sets the pixel width of the output GIF. Height is auto-determined (-1).
		- lanczos is the scaling algorithm.
		- split allows one-shot GIF generation without storing intermediate PNGs.
		- palettegen and paletteuse control the colors.
		- loop infinitely.
		FFMPEG ref: https://superuser.com/a/556031
		TODO find better alternatives for generating video thumbnails.
	 */
	const { stderr } = await execPromise(
		`"${FFMPEG_PATH}" -i "${videoPath}" ` +
			`-vf "fps=${opts.fps},scale=${opts.width}:-1:flags=lanczos,` +
			`split[s0][s1];[s0]palettegen[p];[s1][p]paletteuse" ` +
			`-loop 0 -loglevel error ${outPath}`
	);

	if (stderr) {
		throw new Error(`[utility.ts:videoToGif] ffmpeg error: ${stderr}`);
	}
}

/**
 * Generates a thumbnail for an image or video file and store in the thumbnail directory.
 * JPEG is used for an image thumbnail. GIF is used for a video thumbnail.
 *
 * @param filePath - Path to the source file
 * @param fileType - MIME type of the file (e.g., 'image/jpeg', 'video/mp4')
 * @returns The full path where the thumbnail was saved
 */
export const generateFileThumbnail = async (filePath: string, fileType: string) => {
	const thumbName = path.parse(filePath).name;
	const thumbExt = fileType.startsWith('image/') ? '.jpg' : '.gif';
	const thumbPath = path.join(FILE_UPLOAD_DIR, 'thumb', thumbName + thumbExt);

	// Generate thumbnail
	if (fileType.startsWith('image/')) await imageThumbnail(filePath, thumbPath);
	else await videoToGif(filePath, thumbPath);
	console.debug('[file-manager.ts:generateFileThumbnail] thumbnail written:', thumbPath);

	return thumbPath;
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
 * - `TAG` is the tag of the file based on type (IMG for images, VID for videos) or keyword (EDT for Edit keyword).
 * - `Index` is the 3-digit per-tag index starting from 0.
 *
 * @param files Files to be remapped. Should be sorted in ascending order of capture time.
 * @param newRootPath The root directory path where remapped files will be placed.
 * @param sortedFolderLabels Array of folder label keywords sorted by priority (higher index = higher priority).
 * @returns Array of objects containing the original file path, new file path, and file ID for each remapped file.
 */
export const remapFilePaths = (
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
 * @param remaps - Array of mappings between source file and destination file paths.
 * @throws Throws an error if any of the source files are missing.
 */
export const copyFilesToDestination = async (remaps: PathRemap[]) => {
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

	await Promise.all(dirs.map((dir) => fs.mkdir(dir, { recursive: true })));

	// Copy files with metadata
	await Promise.all(remaps.map(async (file) => fs.copyFile(file.sourcePath, file.destinationPath)));
};

/**
 * Writes a file to the upload directory with a randomly generated, unique filename.
 *
 * @param file - The File object to be written to disk
 * @returns The full path where the file was saved
 */
export const writeFileToDisk = async (file: File) => {
	const newFileName = crypto.randomUUID().toString();
	const fileExt = path.extname(file.name);
	const filePath = path.join(FILE_UPLOAD_DIR, newFileName + fileExt);

	// Write files to server
	const fileBuffer = Buffer.from(await file.arrayBuffer());
	await fs.writeFile(filePath, fileBuffer);
	console.debug('[file-manager.ts:writeFileToDisk] file written:', filePath);

	return filePath;
};

/**
 * Deletes multiple files from the disk.
 *
 * @param filePaths - Array of file paths to be deleted
 * @throws Error If a file exists but cannot be deleted.
 */
export const deleteFilesFromDisk = async (filePaths: string[]) => {
	await Promise.all(
		filePaths.map(async (filePath) => {
			try {
				await fs.unlink(filePath);
			} catch (error) {
				console.error(`[file-manager.ts:deleteFilesFromDisk] failed to delete ${filePath}:`, error);
				if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
			}
		})
	);
};
