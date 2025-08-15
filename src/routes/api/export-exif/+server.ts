import type { RequestHandler } from './$types';
import fs from 'fs/promises';
import path from 'path';
import { database } from '$lib/server/db';
import { exportExifData } from '$lib/server/exiftool-wrapper';
import { LIBRARY_ROOT_DIR } from '$env/static/private';

export const GET: RequestHandler = async () => {
	// Convert library files into a format compatible with exiftool-wrapper
	const libraryFiles = await database.libraryFiles.get();
	const exifExportFiles = libraryFiles.map((file) => ({
		...file,
		path: path.join(LIBRARY_ROOT_DIR, file.path, file.name)
	}));

	// Create the metadata file
	const metadataPath = await exportExifData(exifExportFiles);
	if (!metadataPath) throw new Error('Cannot generate EXIF metadata for library.');
	const data = await fs.readFile(metadataPath);

	return new Response(data, {
		headers: {
			'Content-Type': 'application/json'
		}
	});
};
