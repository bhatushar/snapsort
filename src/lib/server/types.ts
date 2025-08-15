import { type NonLocationKeywordCategory } from '$lib/types';

/**
 * Type definition for a file modified by the user.
 * Must maintain structural equality to the output of {@link ModifiedFileSchema}.
 * Cannot be inferred from Zod schema due to the circular dependency with the database.
 */
export type ModifiedFile = {
	id: number;
	captureDateTime: Date | null;
	timezone: string | null;
	title: string | null;
	latitude: number | null;
	longitude: number | null;
	altitude: number | null;
	keywordIds: number[];
};

/**
 * Type definition for the new keyword being added by the user.
 * Must maintain structural equality to the output of {@link KeywordInputSchema}.
 * Cannot be inferred from Zod schema due to the circular dependency with the database.
 */
export type KeywordInput = {
	keyword: string;
	isFolderLabel: boolean;
} & (
	| { category: NonLocationKeywordCategory }
	| {
			category: 'Location';
			city: string | null;
			state: string | null;
			country: string;
			latitude: number;
			longitude: number;
			altitude: number | null;
	  }
);
