import { type RequestHandler } from '@sveltejs/kit';
import fs from 'fs/promises';
import { database } from '$lib/server/db';

/**
 * API endpoint to fetch the thumbnail for a specified file.
 *
 * @param params - URL parameters containing the file ID.
 * @returns  HTTP response containing the thumbnail or an error message.
 */
export const GET: RequestHandler = async ({ params }) => {
	try {
		if (!params.file_id) return new Response('No file ID provided to fetch thumbnail.');

		const [file] = await database.queuedFiles.get([parseInt(params.file_id)]);
		// JPEG thumbnails for images, GIF thumbnails for videos
		const contentType = file.mimeType.startsWith('image/') ? 'image/jpeg' : 'image/gif';
		const thumbnail = await fs.readFile(file.thumbnailPath);

		return new Response(thumbnail, {
			headers: {
				'Content-Type': contentType
			}
		});
	} catch (error) {
		console.error('[thumbnail.endpoint.ts] Failed to fetch:', error);
		return new Response(`Failed to fetch thumbnail for file ID ${params.file_id}`);
	}
};
