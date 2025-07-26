import {
	pgTable,
	serial,
	text,
	integer,
	doublePrecision,
	check,
	boolean,
	timestamp,
	primaryKey
} from 'drizzle-orm/pg-core';
import { relations, sql } from 'drizzle-orm';

/**
 * Database table definition for user authentication.
 * The current system is designed to only support single-user. Therefore, the table should only
 * ever contain a single entry.
 *
 * Columns:
 * - `password`: Text field containing password hash.
 */
export const authTable = pgTable('auth', {
	password: text('password').notNull()
});

/**
 * Database table for storing the list of countries associated with the location-based keywords.
 *
 * Columns:
 * - `id`: Serial primary key.
 * - `country`: Unique country names.
 */
export const countriesTable = pgTable('countries', {
	id: serial('id').primaryKey(),
	name: text('name').notNull().unique()
});

/**
 * Database table for storing the list of states associated with the location-based keywords.
 *
 * Columns:
 * - `id`: Serial primary key.
 * - `state`: Unique state names.
 */
export const statesTable = pgTable('states', {
	id: serial('id').primaryKey(),
	name: text('name').notNull().unique()
});

/**
 * Database table for storing the list of cities associated with location-based keywords.
 *
 * Columns:
 * - `id`: Serial primary key.
 * - `city`: Unique city names.
 */
export const citiesTable = pgTable('cities', {
	id: serial('id').primaryKey(),
	name: text('name').notNull().unique()
});

/**
 * Database table for storing GPS location data for keywords.
 * Each location is associated with only one keyword. The GPS coordinates correspond to the keyword
 * value, instead of the city/state/country. This means the same combination of city, state, and
 * country can be mapped to different GPS coordinates.
 *
 * Columns:
 * - `id`: Serial primary key.
 * - `cityId`: Nullable reference to a city, in case of imprecise location. Must be accompanied by a state.
 * - `stateId`: Nullable reference to a state, in case of imprecise location.
 * - `countryId`: Non-nullable reference to a country. Location cannot be THIS imprecise.
 * - `latitude`: GPS latitude, range -90 to 90. Negative value indicates East, positive indicates West.
 * - `longitude`: GPS longitude, range -180 to 180. Negative value indicates South, positive indicates North.
 * - `altitude`: Optional GPS altitude. Negative value indicates below sea-level, positive indicates above sea-level.
 */
export const locationsTable = pgTable(
	'locations',
	{
		id: serial('id').primaryKey(),
		cityId: integer('city_id').references(() => citiesTable.id, {
			onDelete: 'restrict',
			onUpdate: 'cascade'
		}),
		stateId: integer('state_id').references(() => statesTable.id, {
			onDelete: 'restrict',
			onUpdate: 'cascade'
		}),
		countryId: integer('country_id')
			.notNull()
			.references(() => countriesTable.id, { onDelete: 'restrict', onUpdate: 'cascade' }),
		latitude: doublePrecision('latitude').notNull(),
		longitude: doublePrecision('longitude').notNull(),
		altitude: doublePrecision('altitude')
	},
	(table) => [
		check('city_no_state_check', sql`(${table.stateId} IS NOT NULL) OR (${table.cityId} IS NULL)`),
		check('latitude_min_check', sql`${table.latitude} >= -90.0`),
		check('latitude_max_check', sql`${table.latitude} <= 90.0`),
		check('longitude_min_check', sql`${table.longitude} >= -180.0`),
		check('longitude_max_check', sql`${table.longitude} <= 180.0`)
	]
);

/**
 * Database table storing keyword-related data, such as keyword names, their categories,
 * and associated metadata.
 *
 * Columns:
 * - `id`: Serial primary key.
 * - `keyword`: The unique name of the keyword.
 * - `category`: The category of the keyword. Must be one of the following predefined values:
 *   'Album', 'Group', 'Location', 'Person', 'Animal', 'Other'.
 * - `isFolderLabel`: Indicates whether the keyword can be used to label a file's parent folder.
 * - `locationId`: Reference to a location. Defined if and only if the category is 'Location'.
 */
export const keywordsTable = pgTable(
	'keywords',
	{
		id: serial('id').primaryKey(),
		keyword: text('keyword').notNull().unique(),
		category: text('category', {
			enum: ['Album', 'Group', 'Location', 'Person', 'Animal', 'Other']
		}).notNull(),
		isFolderLabel: boolean('is_folder_label').notNull().default(false),
		locationId: integer('location_id').references(() => locationsTable.id, {
			onDelete: 'restrict',
			onUpdate: 'cascade'
		})
	},
	(table) => [
		check(
			'location_check',
			sql`(${table.category} = 'Location' AND ${table.locationId} IS NOT NULL) OR (${table.category} != 'Location' AND ${table.locationId} IS NULL)`
		)
	]
);

/**
 * Database to store metadata for library files (images/videos).
 *
 * Columns:
 * - `id`: Serial primary key.
 * - `name`: Name of the file.
 * - `path`: Path to the file relative to the library root. Does not contain the file name.
 * - `mimeType`: MIME type of the file. Must be an image or a video.
 * - `captureDateTime`: UTC timestamp of when the file was captured.
 * - `timezone`: Timezone associated with the capture date and time.
 * - `title`: Optional title/description for the file.
 * - `latitude`: GPS latitude where the file was captured. Should only be defined if the file is associated with a location-based keyword.
 * - `longitude`: GPS longitude where the file was captured. Should only be defined if the file is associated with a location-based keyword.
 * - `altitude`: Optional GPS altitude.
 *
 * GPS coordinates are stored on a per-file basis, instead of using the default GPS coordinates of the associated
 * keywords. This is done to prioritize the GPS coordinates written by the device when capturing the file.
 */
export const libraryFilesTable = pgTable(
	'library_files',
	{
		id: serial('id').primaryKey(),
		name: text('name').notNull(),
		path: text('path').notNull(),
		mimeType: text('mime_type').notNull(),
		// Store dates in UTC time, but display them in the associated timezone.
		captureDateTime: timestamp('capture_date_time', { mode: 'date' }).notNull(),
		timezone: text('timezone').notNull(),
		title: text('title'),
		latitude: doublePrecision('latitude'),
		longitude: doublePrecision('longitude'),
		altitude: doublePrecision('altitude')
	},
	(table) => [
		check(
			'mime_type_check',
			sql`(${table.mimeType} LIKE 'image/%') OR (${table.mimeType} LIKE 'video/%')`
		),
		// Either both latitude and longitude should be defined or neither should be defined
		check(
			'lat_long_check',
			sql`(${table.latitude} IS NULL AND ${table.longitude} IS NULL) OR (${table.latitude} IS NOT NULL AND ${table.longitude} IS NOT NULL)`
		),
		// Altitude should only be defined if latitude/longitude are present
		check('altitude_check', sql`(${table.latitude} IS NOT NULL) OR (${table.altitude} IS NULL)`),
		check('latitude_min_check', sql`${table.latitude} >= -90.0`),
		check('latitude_max_check', sql`${table.latitude} <= 90.0`),
		check('longitude_min_check', sql`${table.longitude} >= -180.0`),
		check('longitude_max_check', sql`${table.longitude} <= 180.0`)
	]
);

/**
 * Auxiliary table to create many-to-many mappings between library files and keywords.
 *
 * Columns:
 * - `fileId`: Reference to the library file.
 * - `keywordId`: Reference to a keyword.
 */
export const libraryFilesToKeywordsTable = pgTable(
	'library_files_to_keywords',
	{
		fileId: integer('file_id')
			.notNull()
			.references(() => libraryFilesTable.id, { onDelete: 'cascade', onUpdate: 'cascade' }),
		keywordId: integer('keyword_id')
			.notNull()
			.references(() => keywordsTable.id, { onDelete: 'restrict', onUpdate: 'cascade' })
	},
	(table) => [primaryKey({ columns: [table.fileId, table.keywordId] })]
);

/**
 * Database table to store metadata for files queued to be added to the library.
 *
 * Columns:
 * - `id`: Serial primary key.
 * - `name`: Original name of the file.
 * - `path`: Absolute path to the file.
 * - `mimeType`: MIME type of the file. Must be an image or a video.
 * - `captureDateTime`: Nullable UTC timestamp of when the file was captured.
 * - `timezone`: Nullable timezone associated with the capture date and time.
 * - `title`: Optional title/description for the file.
 * - `latitude`: Nullable GPS latitude where the file was captured.
 * - `longitude`: Nullable GPS longitude where the file was captured.
 * - `altitude`: Optional GPS altitude.
 *
 * GPS coordinates are stored on a per-file basis, instead of using the default GPS coordinates of the associated
 * keywords. This is done to prioritize the GPS coordinates written by the device when capturing the file.
 */
export const queuedFilesTable = pgTable(
	'queued_files',
	{
		id: serial('id').primaryKey(),
		name: text('name').notNull(),
		path: text('path').notNull(),
		thumbnailPath: text('thumbnail_path').notNull(),
		mimeType: text('mime_type').notNull(),
		// Store dates in UTC time, but display them in the associated timezone.
		captureDateTime: timestamp('capture_date_time', { mode: 'date' }),
		timezone: text('timezone'),
		title: text('title'),
		latitude: doublePrecision('latitude'),
		longitude: doublePrecision('longitude'),
		altitude: doublePrecision('altitude')
	},
	(table) => [
		check(
			'mime_type_check',
			sql`(${table.mimeType} LIKE 'image/%') OR (${table.mimeType} LIKE 'video/%')`
		),
		check('latitude_min_check', sql`${table.latitude} >= -90.0`),
		check('latitude_max_check', sql`${table.latitude} <= 90.0`),
		check('longitude_min_check', sql`${table.longitude} >= -180.0`),
		check('longitude_max_check', sql`${table.longitude} <= 180.0`)
	]
);

/**
 * Auxiliary table to create many-to-many mappings between queued files and keywords.
 *
 * Columns:
 * - `fileId`: Reference to the queued file.
 * - `keywordId`: Reference to a keyword.
 */
export const queuedFilesToKeywordsTable = pgTable(
	'queued_files_to_keywords',
	{
		fileId: integer('file_id')
			.notNull()
			.references(() => queuedFilesTable.id, { onDelete: 'cascade', onUpdate: 'cascade' }),
		keywordId: integer('keyword_id')
			.notNull()
			.references(() => keywordsTable.id, { onDelete: 'restrict', onUpdate: 'cascade' })
	},
	(table) => [primaryKey({ columns: [table.fileId, table.keywordId] })]
);

/* SECTION: Relation mappings used by Drizzle */

export const citiesRelations = relations(citiesTable, ({ one, many }) => ({
	locations: many(locationsTable)
}));

export const statesRelations = relations(statesTable, ({ one, many }) => ({
	locations: many(locationsTable)
}));

export const countriesRelations = relations(countriesTable, ({ many }) => ({
	locations: many(locationsTable)
}));

export const locationsRelations = relations(locationsTable, ({ one }) => ({
	keyword: one(keywordsTable),
	city: one(citiesTable, { fields: [locationsTable.cityId], references: [citiesTable.id] }),
	state: one(statesTable, { fields: [locationsTable.stateId], references: [statesTable.id] }),
	country: one(countriesTable, {
		fields: [locationsTable.countryId],
		references: [countriesTable.id]
	})
}));

export const keywordsRelations = relations(keywordsTable, ({ one, many }) => ({
	location: one(locationsTable),
	keywordFiles: many(libraryFilesToKeywordsTable),
	keywordQueuedFiles: many(queuedFilesToKeywordsTable)
}));

export const filesRelations = relations(libraryFilesTable, ({ many }) => ({
	fileKeywords: many(libraryFilesToKeywordsTable)
}));

export const filesToKeywordsRelations = relations(libraryFilesToKeywordsTable, ({ one }) => ({
	file: one(libraryFilesTable, {
		fields: [libraryFilesToKeywordsTable.fileId],
		references: [libraryFilesTable.id]
	}),
	keyword: one(keywordsTable, {
		fields: [libraryFilesToKeywordsTable.keywordId],
		references: [keywordsTable.id]
	})
}));

export const queuedFilesRelations = relations(queuedFilesTable, ({ many }) => ({
	queuedFileKeywords: many(queuedFilesToKeywordsTable)
}));

export const queuedFilesToKeywordsRelations = relations(queuedFilesToKeywordsTable, ({ one }) => ({
	file: one(queuedFilesTable, {
		fields: [queuedFilesToKeywordsTable.fileId],
		references: [queuedFilesTable.id]
	}),
	keyword: one(keywordsTable, {
		fields: [queuedFilesToKeywordsTable.keywordId],
		references: [keywordsTable.id]
	})
}));
