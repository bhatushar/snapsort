export const NonLocationKeywordCategories = [
	'Album',
	'Group',
	'Person',
	'Animal',
	'Other'
] as const;
export type NonLocationKeywordCategory = (typeof NonLocationKeywordCategories)[number];

export const KeywordCategories = [...NonLocationKeywordCategories, 'Location'] as const;
export type KeywordCategory = (typeof KeywordCategories)[number];

export type KeywordData =
	| {
			keywordId: number;
			keyword: string;
			category: NonLocationKeywordCategory;
			isFolderLabel: boolean;
	  }
	| {
			keywordId: number;
			keyword: string;
			category: 'Location';
			isFolderLabel: boolean;
			cityId: number | null;
			city: string | null;
			stateId: number | null;
			state: string | null;
			countryId: number;
			country: string;
			latitude: number;
			longitude: number;
			altitude: number | null;
	  };

export type FileData = {
	path: string;
	mimeType: string;
	captureDateTime: Date | null;
	timezone: string;
	title: string | null;
	latitude: number | null;
	longitude: number | null;
	altitude: number | null;
	keywords: string[];
};

export type QueuedFileData = FileData & {
	id: number;
	name: string;
	thumbnailPath: string;
	keywordIds: number[];
};

export type CommittableQueuedFile = QueuedFileData & {
	captureDateTime: Date;
};

export type LibraryFileData = FileData & {
	id: number;
	name: string;
	captureDateTime: Date;
	keywordIds: number[];
};
