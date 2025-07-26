import type { PageServerLoad } from './$types';
import { getLibraryFiles } from '$lib/server/db';

export const load: PageServerLoad = async () => {
	const libraryFiles = await getLibraryFiles();
	return { libraryFiles };
};
