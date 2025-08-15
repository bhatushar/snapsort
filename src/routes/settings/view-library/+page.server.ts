import type { PageServerLoad } from './$types';
import { database } from '$lib/server/db';

export const load: PageServerLoad = async () => {
	const libraryFiles = await database.libraryFiles.get();
	return { libraryFiles };
};
