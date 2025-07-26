import { drizzle } from 'drizzle-orm/node-postgres';
import * as schema from './schema';
import {
	authTable,
	citiesTable,
	countriesTable,
	keywordsTable,
	libraryFilesTable,
	libraryFilesToKeywordsTable,
	locationsTable,
	queuedFilesTable,
	queuedFilesToKeywordsTable,
	statesTable
} from './schema';
import { DATABASE_URL } from '$env/static/private';
import { and, eq, inArray, sql } from 'drizzle-orm';
import type { KeywordCategory } from '$lib/types';
import type { IncomingKeyword } from '../../../routes/settings/manage-keywords/+page.server';

if (!DATABASE_URL) throw new Error('DATABASE_URL is not set');

export const db = drizzle(DATABASE_URL, { schema, casing: 'snake_case' });

type FileData = {
	id: number;
	name: string;
	path: string;
	mimeType: string;
	captureDateTime: Date;
	timezone: string;
	title: string | null;
	latitude: number | null;
	longitude: number | null;
	altitude: number | null;
	keywordIds: number[] | [null];
	keywords: string[] | [null];
};

type QueuedFileData = FileData & {
	id: number;
	thumbnailPath: string;
	keywords: string[];
};

type KeywordData =
	| {
			keywordId: number;
			keyword: string;
			category: KeywordCategory;
			isFolderLabel: boolean;
			cityId: null;
			city: null;
			stateId: null;
			state: null;
			countryId: null;
			country: null;
			latitude: null;
			longitude: null;
			altitude: null;
	  }
	| {
			keywordId: number;
			keyword: string;
			category: 'Location';
			isFolderLabel: boolean;
			cityId: number;
			city: string;
			stateId: number;
			state: string;
			countryId: number;
			country: string;
			latitude: number;
			longitude: number;
			altitude: number | null;
	  };

type Location = {
	city: string | null;
	state: string | null;
	country: string;
	latitude: number;
	longitude: number;
	altitude: number | null;
};

/**
 * @returns Library files with their associated keywords
 */
export const getLibraryFiles = async () => {
	return (await db
		.select({
			id: libraryFilesTable.id,
			name: libraryFilesTable.name,
			mimeType: libraryFilesTable.mimeType,
			path: libraryFilesTable.path,
			captureDateTime: libraryFilesTable.captureDateTime,
			timezone: libraryFilesTable.timezone,
			title: libraryFilesTable.title,
			latitude: libraryFilesTable.latitude,
			longitude: libraryFilesTable.longitude,
			altitude: libraryFilesTable.altitude,
			keywordIds: sql`array_agg(${keywordsTable.id})`,
			keywords: sql`array_agg(${keywordsTable.keyword})`
		})
		.from(libraryFilesTable)
		.leftJoin(
			libraryFilesToKeywordsTable,
			eq(libraryFilesTable.id, libraryFilesToKeywordsTable.fileId)
		)
		.leftJoin(keywordsTable, eq(libraryFilesToKeywordsTable.keywordId, keywordsTable.id))
		.orderBy(libraryFilesTable.captureDateTime)
		.groupBy(libraryFilesTable.id)) as FileData[];
};

/**
 * @param subsetFileIds Optional queued file IDs to filter the result
 * @returns Queued files with the associated keywords
 */
export const getQueuedFilesData = async (
	subsetFileIds: number[] = []
): Promise<QueuedFileData[]> => {
	const queuedFiles = (await db
		.select({
			id: queuedFilesTable.id,
			name: queuedFilesTable.name,
			path: queuedFilesTable.path,
			thumbnailPath: queuedFilesTable.thumbnailPath,
			mimeType: queuedFilesTable.mimeType,
			captureDateTime: queuedFilesTable.captureDateTime,
			timezone: queuedFilesTable.timezone,
			title: queuedFilesTable.title,
			latitude: queuedFilesTable.latitude,
			longitude: queuedFilesTable.longitude,
			altitude: queuedFilesTable.altitude,
			keywordIds: sql`array_agg(${keywordsTable.id})`,
			keywords: sql`array_agg(${keywordsTable.keyword})`
		})
		.from(queuedFilesTable)
		.leftJoin(
			queuedFilesToKeywordsTable,
			eq(queuedFilesTable.id, queuedFilesToKeywordsTable.fileId)
		)
		.leftJoin(keywordsTable, and(eq(queuedFilesToKeywordsTable.keywordId, keywordsTable.id)))
		.where(subsetFileIds.length ? inArray(queuedFilesTable.id, subsetFileIds) : undefined)
		.orderBy(queuedFilesTable.captureDateTime)
		.groupBy(queuedFilesTable.id)) as (QueuedFileData & {
		keywordIds: (number | null)[];
		keywords: (string | null)[];
	})[];

	return queuedFiles.map(({ keywords, keywordIds, ...file }) => {
		return {
			keywordIds: keywordIds.filter((id: number | null) => id !== null),
			keywords: keywords.filter((kw: string | null) => kw !== null),
			...file
		};
	});
};

/**
 * @param subsetKeywordIds Optional keyword IDs to filter the result
 * @returns Keywords sorted in descending order of priority
 */
export const getPriorityOrderedFolderLabels = async (
	subsetKeywordIds: number[] = []
): Promise<string[]> => {
	const result = await db
		.select({
			keyword: keywordsTable.keyword
		})
		.from(keywordsTable)
		.where(
			and(
				eq(keywordsTable.isFolderLabel, true),
				subsetKeywordIds.length ? inArray(keywordsTable.id, subsetKeywordIds) : undefined
			)
		).orderBy(sql`
			CASE
				WHEN ${keywordsTable.category} = 'Album' THEN 1
				WHEN ${keywordsTable.category} = 'Group' THEN 2
				ELSE 3
			END DESC
		`); // Category priority: Album > Group > Others
	return result.map(({ keyword }) => keyword);
};

/**
 * Add data to the library files table.
 * @param files
 */
export const addFilesToLibrary = async (files: FileData[]) => {
	await db.transaction(async (tx) => {
		await Promise.all(
			files.map(async ({ id: _, ...file }) => {
				console.debug('[db.ts:addFilesToLibrary] inserting:', file);
				const [{ fileId }] = await tx
					.insert(libraryFilesTable)
					.values(file)
					.returning({ fileId: libraryFilesTable.id });
				const fileKeywords = file.keywordIds
					.filter((kw) => kw !== null)
					.map((kw) => ({ fileId, keywordId: kw }));
				console.debug('[db.ts:addFilesToLibrary] inserting keywords:', fileKeywords);
				if (fileKeywords.length) await tx.insert(libraryFilesToKeywordsTable).values(fileKeywords);
			})
		);
	});
};

/**
 * Get the default login password.
 * @returns Password hash if exists, undefined otherwise
 */
export const getLoginPassword = async () => {
	const result = await db.query.authTable.findFirst();
	return result?.password;
};

/**
 * Set the default login password.
 * @param passwordHash
 */
export const setLoginPassword = async (passwordHash: string) => {
	await db.transaction(async (tx) => {
		// Currently, only single-user support is present. Delete the existing password before storing the new one.
		await tx.delete(authTable);
		await tx.insert(authTable).values({ password: passwordHash });
	});
};

/**
 * @param subsetKeywords Optional list of keywords to filter the results
 * @returns Keywords including the associated GPS information.
 */
export const getKeywords = async (subsetKeywords: string[] = []): Promise<KeywordData[]> => {
	return (
		(await db
			.select({
				keywordId: keywordsTable.id,
				keyword: keywordsTable.keyword,
				category: keywordsTable.category,
				isFolderLabel: keywordsTable.isFolderLabel,
				cityId: citiesTable.id,
				city: citiesTable.name,
				stateId: statesTable.id,
				state: statesTable.name,
				countryId: countriesTable.id,
				country: countriesTable.name,
				latitude: locationsTable.latitude,
				longitude: locationsTable.longitude,
				altitude: locationsTable.altitude
			})
			.from(keywordsTable)
			.leftJoin(locationsTable, eq(keywordsTable.locationId, locationsTable.id))
			.leftJoin(citiesTable, eq(locationsTable.cityId, citiesTable.id))
			.leftJoin(statesTable, eq(locationsTable.stateId, statesTable.id))
			.leftJoin(countriesTable, eq(locationsTable.countryId, countriesTable.id))
			.where(subsetKeywords.length ? inArray(keywordsTable.keyword, subsetKeywords) : undefined)
			// Sort by category, location and then keyword name
			.orderBy(
				keywordsTable.category,
				countriesTable.name,
				statesTable.name,
				citiesTable.name,
				keywordsTable.keyword
			)) as KeywordData[]
	);
};

/**
 * @param cities Optional list of cities to filter the result
 * @return List of cities
 */
export const getCities = async (cities: string[] = []): Promise<{ id: number; name: string }[]> => {
	return db
		.select({
			id: citiesTable.id,
			name: citiesTable.name
		})
		.from(citiesTable)
		.where(cities.length ? inArray(citiesTable.name, cities) : undefined);
};

/**
 * @param states Optional list to filter the result
 * @returns List of states
 */
export const getStates = async (states: string[] = []): Promise<{ id: number; name: string }[]> => {
	return db
		.select({
			id: statesTable.id,
			name: statesTable.name
		})
		.from(statesTable)
		.where(states.length ? inArray(statesTable.name, states) : undefined);
};

/**
 * @param countries Optional list to filter the result
 * @returns List of countries
 */
export const getCountries = async (
	countries: string[] = []
): Promise<{ id: number; name: string }[]> => {
	return db
		.select({
			id: countriesTable.id,
			name: countriesTable.name
		})
		.from(countriesTable)
		.where(countries.length ? inArray(countriesTable.name, countries) : undefined);
};

/**
 * Add new city to the database
 * @param city Name of the city
 * @returns ID of the newly created city
 */
const addCity = async (city: string): Promise<number> => {
	const [{ cityId }] = await db
		.insert(citiesTable)
		.values({ name: city })
		.returning({ cityId: citiesTable.id });
	return cityId;
};

/**
 * Add new state to the database
 * @param state Name of the state
 * @returns ID of the newly created state
 */
const addState = async (state: string): Promise<number> => {
	const [{ stateId }] = await db
		.insert(statesTable)
		.values({ name: state })
		.returning({ stateId: statesTable.id });
	return stateId;
};

/**
 * Add new country to the database
 * @param country Name of the country
 * @returns ID of the newly created country
 */
const addCountry = async (country: string): Promise<number> => {
	const [{ countryId }] = await db
		.insert(countriesTable)
		.values({ name: country })
		.returning({ countryId: countriesTable.id });
	return countryId;
};

/**
 * Add a new location entry in the database. Also add corresponding city/state/country information.
 *
 * @param location
 * @returns ID of the newly created location
 */
const addLocation = async (location: Location): Promise<number> => {
	// Fetch existing city/state/country or create new one.
	let cityId: number | null = null;
	if (location.city) {
		const city = await getCities([location.city]);
		cityId = city.length ? city[0].id : await addCity(location.city);
	}

	let stateId: number | null = null;
	if (location.state) {
		const state = await getStates([location.state]);
		stateId = state.length ? state[0].id : await addState(location.state);
	}

	const country = await getCountries([location.country]);
	const countryId = country.length ? country[0].id : await addCountry(location.country);

	// Add new location
	const { latitude, longitude, altitude } = location;
	const [{ locationId }] = await db
		.insert(locationsTable)
		.values({ cityId, stateId, countryId, latitude, longitude, altitude })
		.returning({ locationId: locationsTable.id });

	return locationId;
};

/**
 * Add a new keyword to the database. Also add the associated location information.
 *
 * @param data
 * @returns ID of the newly created keyword
 */
export const addKeyword = async (data: IncomingKeyword): Promise<number> => {
	let locationId: number | null = null;

	if (data.category === 'Location') {
		locationId = await addLocation(data);
	}

	const [{ keywordId }] = await db
		.insert(keywordsTable)
		.values({
			keyword: data.keyword,
			category: data.category,
			isFolderLabel: data.isFolderLabel,
			locationId
		})
		.returning({ keywordId: keywordsTable.id });

	return keywordId;
};
