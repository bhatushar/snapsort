import { drizzle, LibSQLDatabase } from 'drizzle-orm/libsql';
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
import { and, count, eq, inArray, not, or, sql } from 'drizzle-orm';
import type {
	FileData,
	KeywordCategory,
	KeywordData,
	LibraryFileData,
	QueuedFileData
} from '$lib/types';
import type { KeywordInput, ModifiedFile } from '$lib/server/types';
import { deleteFilesFromDisk } from '$lib/server/file-manager';

if (!DATABASE_URL) throw new Error('DATABASE_URL is not set');

type Database = LibSQLDatabase<typeof schema>;
type DatabaseTransaction = Parameters<Parameters<Database['transaction']>[0]>[0];

// Use memoization to connect to the database to avoid build-time connection failures
const db = (() => {
	let _db: Database | null = null;

	return () => {
		if (!_db) _db = drizzle(DATABASE_URL, { schema, casing: 'snake_case' });
		return _db;
	};
})();

export type QueuedFileInput = FileData & {
	name: string;
	thumbnailPath: string;
};

export type LibraryFileInput = FileData & {
	name: string;
	captureDateTime: Date;
};

type LocationData = {
	city: string | null;
	state: string | null;
	country: string;
	latitude: number;
	longitude: number;
	altitude: number | null;
};

/**
 * Add new city to the database
 * @param city Name of the city
 * @returns ID of the newly created city
 */
const addCity = async (city: string): Promise<number> => {
	const [{ cityId }] = await db()
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
	const [{ stateId }] = await db()
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
	const [{ countryId }] = await db()
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
const addLocation = async (location: LocationData): Promise<number> => {
	// Fetch existing city/state/country or create new one.
	let cityId: number | null = null;
	if (location.city) {
		const city = await database.locations.getCities([location.city]);
		cityId = city.length ? city[0].id : await addCity(location.city);
	}

	let stateId: number | null = null;
	if (location.state) {
		const state = await database.locations.getStates([location.state]);
		stateId = state.length ? state[0].id : await addState(location.state);
	}

	const country = await database.locations.getCountries([location.country]);
	const countryId = country.length ? country[0].id : await addCountry(location.country);

	// Add a new location
	const { latitude, longitude, altitude } = location;
	const [{ locationId }] = await db()
		.insert(locationsTable)
		.values({ cityId, stateId, countryId, latitude, longitude, altitude })
		.returning({ locationId: locationsTable.id });

	return locationId;
};

/**
 * Adds keyword associations for a given file in the specified database table.
 *
 * @param tx - The database transaction object used for executing queries.
 * @param filesToKeywordsTable - The table in which the file-to-keyword associations should be stored.
 * @param fileId - The unique identifier of the file to associate keywords with.
 * @param keywords - An array of keyword strings to be associated with the file.
 *
 * @throws {Error} If a database operation fails.
 */
const addKeywordsForFile = async (
	tx: DatabaseTransaction,
	filesToKeywordsTable: typeof queuedFilesToKeywordsTable | typeof libraryFilesToKeywordsTable,
	fileId: number,
	keywords: string[]
) => {
	if (keywords.length) {
		const validKeywords = await tx
			.select({ keywordId: keywordsTable.id, keyword: keywordsTable.keyword })
			.from(keywordsTable)
			.where(inArray(keywordsTable.keyword, keywords));

		if (validKeywords.length) {
			await tx
				.insert(filesToKeywordsTable)
				.values(validKeywords.map(({ keywordId }) => ({ fileId, keywordId })));
		}

		if (validKeywords.length !== keywords.length) {
			// Queued files might contain pre-existing keywords which don't exist in the database
			console.warn(
				`[db.ts:queuedFiles.add] File ID ${fileId} has unknown keywords:`,
				keywords.filter((kw) => validKeywords.every(({ keyword }) => keyword !== kw))
			);
		}
	}
};

export const database = {
	auth: {
		/**
		 * Get the default login password.
		 * @returns Password hash if exists, undefined otherwise
		 */
		getLoginPassword: async (): Promise<string | undefined> => {
			const result = await db().query.authTable.findFirst();
			return result?.password;
		},

		/**
		 * Set the default login password.
		 * @param passwordHash
		 */
		setLoginPassword: async (passwordHash: string) => {
			await db().transaction(async (tx) => {
				// Currently, only single-user support is present. Delete the existing password before storing the new one.
				await tx.delete(authTable);
				await tx.insert(authTable).values({ password: passwordHash });
			});
		}
	},

	queuedFiles: {
		/**
		 * @param subsetFileIds Optional queued file IDs to filter the result
		 * @returns Queued files with the associated keywords
		 */
		get: async (subsetFileIds: number[] = []): Promise<QueuedFileData[]> => {
			const queuedFiles = (await db()
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
					keywordIds: sql`string_agg(${keywordsTable.id}, ';')`,
					keywords: sql`string_agg(${keywordsTable.keyword}, ';')`
				})
				.from(queuedFilesTable)
				.leftJoin(
					queuedFilesToKeywordsTable,
					eq(queuedFilesTable.id, queuedFilesToKeywordsTable.fileId)
				)
				.leftJoin(keywordsTable, and(eq(queuedFilesToKeywordsTable.keywordId, keywordsTable.id)))
				.where(subsetFileIds.length ? inArray(queuedFilesTable.id, subsetFileIds) : undefined)
				.orderBy(queuedFilesTable.captureDateTime)
				.groupBy(queuedFilesTable.id)) as (Omit<QueuedFileData, 'keywordIds' | 'keywords'> & {
				keywordIds: string | null;
				keywords: string | null;
			})[];

			return queuedFiles.map(({ keywords, keywordIds, ...file }) => {
				return {
					keywordIds: keywordIds?.split(';').map((keywordId) => parseInt(keywordId)) ?? [],
					keywords: keywords?.split(';') ?? [],
					...file
				};
			});
		},

		add: async (file: QueuedFileInput) => {
			await db().transaction(async (tx) => {
				// Append the new file to the database queue
				const [{ fileId }] = await tx
					.insert(queuedFilesTable)
					.values(file)
					.returning({ fileId: queuedFilesTable.id });
				await addKeywordsForFile(tx, queuedFilesToKeywordsTable, fileId, file.keywords);
			});
		},

		delete: async (fileIds: number[]) => {
			await db().transaction(async (tx) => {
				const filePaths = await tx
					.select({
						filePath: queuedFilesTable.path,
						thumbnailPath: queuedFilesTable.thumbnailPath
					})
					.from(queuedFilesTable)
					.where(inArray(queuedFilesTable.id, fileIds));
				await tx.delete(queuedFilesTable).where(inArray(queuedFilesTable.id, fileIds));
				await deleteFilesFromDisk(
					filePaths.flatMap(({ filePath, thumbnailPath }) => [filePath, thumbnailPath])
				);
			});
		},

		update: async (fileChanges: ModifiedFile[]) => {
			if (fileChanges.length === 0) return;

			const fileKeywordPairs = fileChanges.flatMap((file) =>
				file.keywordIds.flatMap((kw) => ({ fileId: file.id, keywordId: kw }))
			);

			await db().transaction(async (tx) => {
				await Promise.all([
					// Update file metadata
					...fileChanges.map(async (file) =>
						tx.update(queuedFilesTable).set(file).where(eq(queuedFilesTable.id, file.id))
					),

					// Delete mappings for keywords removed by the user
					...fileChanges.map(async (file) =>
						tx
							.delete(queuedFilesToKeywordsTable)
							.where(
								and(
									eq(queuedFilesToKeywordsTable.fileId, file.id),
									not(inArray(queuedFilesToKeywordsTable.keywordId, file.keywordIds))
								)
							)
					),

					// Add new keywords, if any
					fileKeywordPairs.length &&
						tx.insert(queuedFilesToKeywordsTable).values(fileKeywordPairs).onConflictDoNothing()
				]);
			});
		},

		/**
		 * @param fileIds Optional queued file IDs to filter the result
		 * @returns Number of queued files
		 */
		count: async (fileIds: number[] = []): Promise<number> => {
			const [{ fileCount }] = await db()
				.select({ fileCount: count(queuedFilesTable.id) })
				.from(queuedFilesTable)
				.where(fileIds.length ? inArray(queuedFilesTable.id, fileIds) : undefined);
			return fileCount;
		}
	},

	libraryFiles: {
		/**
		 * @returns Library files with their associated keywords
		 */
		get: async (): Promise<LibraryFileData[]> => {
			const libraryFiles = (await db()
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
					keywordIds: sql`string_agg(${keywordsTable.id}, ';')`,
					keywords: sql`string_agg(${keywordsTable.keyword}, ';')`
				})
				.from(libraryFilesTable)
				.leftJoin(
					libraryFilesToKeywordsTable,
					eq(libraryFilesTable.id, libraryFilesToKeywordsTable.fileId)
				)
				.leftJoin(keywordsTable, eq(libraryFilesToKeywordsTable.keywordId, keywordsTable.id))
				.orderBy(libraryFilesTable.captureDateTime)
				.groupBy(libraryFilesTable.id)) as (Omit<LibraryFileData, 'keywordIds' | 'keywords'> & {
				keywordIds: string | null;
				keywords: string | null;
			})[];

			return libraryFiles.map(({ keywordIds, keywords, ...file }) => ({
				keywordIds: keywordIds?.split(';').map((keywordId) => parseInt(keywordId)) ?? [],
				keywords: keywords?.split(';') ?? [],
				...file
			}));
		},

		/**
		 * Add data to the library files table.
		 * @param files
		 */
		add: async (files: LibraryFileInput[]) => {
			await db().transaction(async (tx) => {
				await Promise.all(
					files.map(async (file) => {
						const [{ fileId }] = await tx
							.insert(libraryFilesTable)
							.values(file)
							.returning({ fileId: libraryFilesTable.id });
						await addKeywordsForFile(tx, libraryFilesToKeywordsTable, fileId, file.keywords);
					})
				);
			});
		}
	},

	keywords: {
		/**
		 * @param subsetKeywords Optional list of keywords to filter the results
		 * @returns Keywords including the associated GPS information.
		 */
		get: async (subsetKeywords: string[] = []): Promise<KeywordData[]> => {
			return (
				(await db()
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
		},

		/**
		 * Add a new keyword to the database. Also add the associated location information.
		 *
		 * @param data
		 * @returns ID of the newly created keyword
		 */
		add: async (data: KeywordInput): Promise<number> => {
			let locationId: number | null = null;

			if (data.category === 'Location') {
				locationId = await addLocation(data);
			}

			const [{ keywordId }] = await db()
				.insert(keywordsTable)
				.values({
					keyword: data.keyword,
					category: data.category,
					isFolderLabel: data.isFolderLabel,
					locationId
				})
				.returning({ keywordId: keywordsTable.id });

			return keywordId;
		},

		count: async (keywordIds: number[] = []): Promise<number> => {
			const [{ keywordCount }] = await db()
				.select({ keywordCount: count(keywordsTable.id) })
				.from(keywordsTable)
				.where(keywordIds.length ? inArray(keywordsTable.id, keywordIds) : undefined);
			return keywordCount;
		},

		countByCategory: async (
			categories: KeywordCategory[],
			keywordIds: number[] = []
		): Promise<{ keywordCategory: KeywordCategory; keywordCount: number }[]> => {
			return db()
				.select({ keywordCategory: keywordsTable.category, keywordCount: count(keywordsTable.id) })
				.from(keywordsTable)
				.where(
					and(
						keywordIds.length ? inArray(keywordsTable.id, keywordIds) : undefined,
						or(...categories.map((category) => eq(keywordsTable.category, category)))
					)
				)
				.groupBy(keywordsTable.category);
		},

		/**
		 * @param subsetKeywordIds Optional keyword IDs to filter the result
		 * @returns Keywords sorted in ascending order of priority
		 */
		getFolderLabels: async (subsetKeywordIds: number[] = []): Promise<string[]> => {
			const result = await db()
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
				WHEN ${keywordsTable.category} = 'Album' THEN 3
				WHEN ${keywordsTable.category} = 'Group' THEN 2
				ELSE 1
			END
		`); // Category priority: Album > Group > Others
			return result.map(({ keyword }) => keyword);
		}
	},

	locations: {
		/**
		 * @param cities Optional list of cities to filter the result
		 * @return List of cities
		 */
		getCities: async (cities: string[] = []): Promise<{ id: number; name: string }[]> => {
			return db()
				.select({
					id: citiesTable.id,
					name: citiesTable.name
				})
				.from(citiesTable)
				.where(cities.length ? inArray(citiesTable.name, cities) : undefined);
		},

		/**
		 * @param states Optional list to filter the result
		 * @returns List of states
		 */
		getStates: async (states: string[] = []): Promise<{ id: number; name: string }[]> => {
			return db()
				.select({
					id: statesTable.id,
					name: statesTable.name
				})
				.from(statesTable)
				.where(states.length ? inArray(statesTable.name, states) : undefined);
		},

		/**
		 * @param countries Optional list to filter the result
		 * @returns List of countries
		 */
		getCountries: async (countries: string[] = []): Promise<{ id: number; name: string }[]> => {
			return db()
				.select({
					id: countriesTable.id,
					name: countriesTable.name
				})
				.from(countriesTable)
				.where(countries.length ? inArray(countriesTable.name, countries) : undefined);
		}
	}
};
