import { ModifiedFileSchema } from '$lib/server/types';
import { z } from 'zod';

export type KeywordCategory = 'Album' | 'Group' | 'Location' | 'Person' | 'Animal' | 'Other';

export type KeywordData = {
	id: number;
	name: string;
	category: KeywordCategory;
	city: string | null;
	state: string | null;
	country: string | null;
	latitude: number | null;
	longitude: number | null;
	altitude: number | null;
};

export type FileMetadata = {
	captureDate: string | null;
	captureTime: string | null;
	timezone: string | null;
	title: string | null;
	latitude: number | null;
	longitude: number | null;
	altitude: number | null;
	keywordIds: number[];
};

export type QueuedFileData = {
	id: number;
	name: string;
	path: string;
} & FileMetadata;

export type IndexPageResponse = {
	keywordCtx: KeywordData[];
	queuedFilesData: QueuedFileData[];
};

export type ModifiedFileInput = z.input<typeof ModifiedFileSchema>;
