import fs from 'fs/promises';
import { EXIFTOOL_PATH, FILE_UPLOAD_DIR } from '$env/static/private';
import { execPromise } from '$lib/server/utility';
import { DateTime } from 'luxon';
import { z } from 'zod';
import { isValueSet, regexPatterns, removeDuplicatesPredicate } from '$lib/utility';
import path from 'path';

/* SECTION: Local types */

/*
 * NOTE ON EXIF PROPERTY TYPES:
 * Some union types are accompanied by a const array with all the values. This is done to make it
 * easy to iterate over the union types. Ensure that the types and arrays are always in sync.
 * Additionally, the order in which array entries are defined determines the priority of that
 * property when merging into simplified property. Property present at a lower index in the array
 * takes precedence over a property present at a higher index.
 */

/**
 * Exif properties related to the date and time at which an image/video was captured.
 */
type ExifDateTimeProp =
	| 'DateTimeCreated' // yyyy:mm:dd HH:MM:SS+hh:mm (captured timezone offset, only for images)
	| 'Quicktime:CreationDate' // yyyy:mm:dd HH:MM:SS+hh:mm (captured timezone offset, only for videos)
	| 'Quicktime:DateTimeOriginal' // yyyy:mm:dd HH:MM:SS+hh:mm (captured timezone offset, only for videos)
	| 'DateTimeOriginal' // yyyy:mm:dd HH:MM:SS (captured timezone offset, only for images)
	| 'TrackCreateDate' // yyyy:mm:dd HH:MM:SS (UTC offset, only for video)
	| 'MediaCreateDate' // yyyy:mm:dd HH:MM:SS (UTC offset, only for video)
	| 'CreateDate'; // yyyy:mm:dd HH:MM:SS (captured timezone offset for images, UTC offset for videos)
const ExifDateTimeProps = [
	'DateTimeCreated',
	'Quicktime:CreationDate',
	'Quicktime:DateTimeOriginal',
	'DateTimeOriginal',
	'TrackCreateDate',
	'MediaCreateDate',
	'CreateDate'
] as const;

/**
 * Exif properties related to the timezone offset of an image/video.
 */
type ExifOffsetTimeProp = 'OffsetTime' | 'OffsetTimeOriginal' | 'OffsetTimeDigitized'; //+hh:mm
const ExifOffsetTimeProps = ['OffsetTime', 'OffsetTimeOriginal', 'OffsetTimeDigitized'] as const;

/**
 * Exif properties related to the title/description of an image/video.
 */
type ExifTitleProp = 'Title' | 'Description' | 'XPTitle' | 'ImageDescription'; // string
const ExifTitleProps = ['Title', 'Description', 'XPTitle', 'ImageDescription'] as const;

/**
 * Exif properties related to the keywords present in an image/video.
 */
type ExifKeywordsProp =
	| 'Category' // ["tag1", "tag2"] or "tag" (only for videos)
	| 'Keywords' // ["tag1", "tag2"] or "tag" (only for images)
	| 'Subject' // ["tag1", "tag2"] or "tag" (only for images)
	| 'XPKeywords'; // "tag1;tag2" (only for images)
const ExifKeywordsProps = ['Category', 'Keywords', 'Subject', 'XPKeywords'] as const;

type ExifSimplifiedProp = ExifDateTimeProp | ExifOffsetTimeProp | ExifTitleProp | ExifKeywordsProp;
const ExifSimplifiedProps = [
	...ExifDateTimeProps,
	...ExifOffsetTimeProps,
	...ExifTitleProps,
	...ExifKeywordsProps
] as const;

/**
 * Properties stored in a file's exif data. These are used as arguments to exiftool command.
 * This is an incomplete list and doesn't contain all the exif properties in existence, only the
 * ones relevant to this project.
 */
type ExifProp =
	| 'MIMEType' // image/* or video/*
	| 'GPSLatitude' // number, inclusive range from -90 to 90
	| 'GPSLatitudeRef' // string, N for positive latitude, S for negative latitude
	| 'GPSLongitude' // number, inclusive range from -180 to 180
	| 'GPSLongitudeRef' // string, E for positive longitude, W for negative longitude
	| 'GPSAltitude' // number, positive for above sea-level, negative for below sea-level
	| 'GPSAltitudeRef' // number, 0 for above sea-level, 1 for below sea-level
	| 'GPSCoordinates' // "latitude longitude altitude" (only for videos)
	| ExifSimplifiedProp;

/* SECTION: Exif data validation schemas */

/**
 * Schema definition for extracting and validating Exif metadata.
 * This schema stores the Exif data in Exiftool-compatible format while enforcing validation
 * constraints on various properties.
 *
 * SourceFile and MIMEType are the only mandatory properties. Remaining properties default to
 * undefined and do not throw any errors if validation fails.
 */
const ExifReadableDataSchema = z.object({
	// Path to the image/video. Not used currently.
	SourceFile: z.string(),
	// MIMEType must start with 'image/' or 'video/'.
	MIMEType: z
		.string()
		.refine(
			(mime) => mime.startsWith('image/') || mime.startsWith('video/'),
			'File is neither an image nor a video'
		),
	// Some datetime properties include a timezone offset. Also, all 0s are considered invalid.
	DateTimeOriginal: z
		.string()
		.refine((date) => regexPatterns.exifDateTime.test(date))
		.refine((date) => date !== '0000:00:00 00:00:00')
		.optional()
		.catch(undefined),
	'Quicktime:CreationDate': z
		.string()
		.refine((date) => regexPatterns.exifDateTimeOffset.test(date))
		.refine((date) => date !== '0000:00:00 00:00:00')
		.optional()
		.catch(undefined),
	'Quicktime:DateTimeOriginal': z
		.string()
		.refine((date) => regexPatterns.exifDateTimeOffset.test(date))
		.refine((date) => date !== '0000:00:00 00:00:00')
		.optional()
		.catch(undefined),
	TrackCreateDate: z
		.string()
		.refine((date) => regexPatterns.exifDateTime.test(date))
		.refine((date) => date !== '0000:00:00 00:00:00')
		.optional()
		.catch(undefined),
	MediaCreateDate: z
		.string()
		.refine((date) => regexPatterns.exifDateTime.test(date))
		.refine((date) => date !== '0000:00:00 00:00:00')
		.optional()
		.catch(undefined),
	DateTimeCreated: z
		.string()
		.refine((date) => regexPatterns.exifDateTimeOffset.test(date))
		// Not sure if offset is included in an invalid date
		.refine((date) => !date.startsWith('0000:00:00 00:00:00'))
		.optional()
		.catch(undefined),
	CreateDate: z
		.string()
		.refine((date) => regexPatterns.exifDateTime.test(date))
		.refine((date) => date !== '0000:00:00 00:00:00')
		.optional()
		.catch(undefined),
	OffsetTime: z
		.string()
		.refine((offset) => regexPatterns.exifTimezoneOffset.test(offset))
		.optional()
		.catch(undefined),
	OffsetTimeOriginal: z
		.string()
		.refine((offset) => regexPatterns.exifTimezoneOffset.test(offset))
		.optional()
		.catch(undefined),
	OffsetTimeDigitized: z
		.string()
		.refine((offset) => regexPatterns.exifTimezoneOffset.test(offset))
		.optional()
		.catch(undefined),
	Title: z.string().optional().catch(undefined),
	Description: z.string().optional().catch(undefined),
	XPTitle: z.string().optional().catch(undefined),
	ImageDescription: z.string().optional().catch(undefined),
	// All keywords (except XPKeywords) are converted to an array for consistency.
	Category: z
		.union([z.string().transform((keyword) => [keyword]), z.array(z.string()).min(1)])
		.optional()
		.catch(undefined),
	Keywords: z
		.union([z.string().transform((keyword) => [keyword]), z.array(z.string()).min(1)])
		.optional()
		.catch(undefined),
	Subject: z
		.union([z.string().transform((keyword) => [keyword]), z.array(z.string()).min(1)])
		.optional()
		.catch(undefined),
	XPKeywords: z.string().optional().catch(undefined),
	GPSLatitude: z.number().min(-90).max(90).optional().catch(undefined),
	GPSLatitudeRef: z.enum(['N', 'S']).optional().catch(undefined),
	GPSLongitude: z.number().min(-180).max(180).optional().catch(undefined),
	GPSLongitudeRef: z.enum(['W', 'E']).optional().catch(undefined),
	GPSAltitude: z.number().optional().catch(undefined),
	GPSAltitudeRef: z
		.union([z.literal(0), z.literal(1)])
		.optional()
		.catch(undefined),
	GPSCoordinates: z
		.string()
		.refine((coordinate) => regexPatterns.gpsCoordinates.test(coordinate))
		.optional()
		.catch(undefined)
});

/**
 * Object type extracted from {@link ExifReadableDataSchema}.
 */
type ExifData = z.infer<typeof ExifReadableDataSchema>;

/**
 * Represents a schema for simplified Exif data extracted from a media file.
 * This schema is derived from {@link ExifReadableDataSchema} by combining several properties into one.
 *
 * The transformed properties include:
 * - `DateTime`: Extracted and converted to a `Date` object, representing the timestamp from Exif metadata.
 * - `OffsetTime`: The UTC offset information, if available, for the extracted datetime.
 * - `Title`: A description string derived from Exif title-related properties.
 * - `Keywords`: An array of keywords/tags extracted from Exif metadata.
 *
 * Remaining properties in {@link ExifReadableDataSchema} are included as is.
 */
const ExifReadableDataSimplifiedSchema = ExifReadableDataSchema.transform((data) => {
	let dateTimeValue: Date | undefined = undefined;
	let offsetValue: string | undefined = undefined;
	let titleValue: string | undefined = undefined;
	let keywordsValue: string[] | undefined = undefined;

	// Extract datetime and offset info
	const dateTimeProp = ExifDateTimeProps.find((prop) => data[prop] !== undefined);
	if (dateTimeProp && data[dateTimeProp]) {
		const offsetProp = ExifOffsetTimeProps.find((prop) => data[prop] !== undefined);
		offsetValue = offsetProp && data[offsetProp];

		if (
			data.MIMEType.startsWith('image/') ||
			dateTimeProp === 'Quicktime:CreationDate' ||
			dateTimeProp === 'Quicktime:DateTimeOriginal'
		) {
			// DateTime string is relative to the original timezone
			const luxonDateTime = parseExifDateTime(data[dateTimeProp], offsetValue);
			if (luxonDateTime) dateTimeValue = luxonDateTime.toJSDate();
		} else {
			// DateTime string is relative to the UTC timezone
			const luxonDateTime = parseExifDateTime(data[dateTimeProp], '+00:00');
			if (luxonDateTime) dateTimeValue = luxonDateTime.toJSDate();
		}
	}

	// Extract title info
	const titleProp = ExifTitleProps.find((prop) => data[prop] !== undefined);
	titleValue = titleProp && data[titleProp];

	// Extract keyword info
	const keywordsProp = ExifKeywordsProps.find((prop) => data[prop] !== undefined);
	if (keywordsProp === 'XPKeywords') keywordsValue = data.XPKeywords?.split(';');
	else if (keywordsProp) keywordsValue = data[keywordsProp];

	// Extract the remaining info (everything except simplified props)
	// Reason for doing this in such a round about way is to make TypeScript happy
	const undefinedSimplifiedProps = ExifSimplifiedProps.reduce((acc, prop) => {
		acc[prop] = undefined;
		return acc;
	}, {} as ExifData);
	const remainingData = {
		...data,
		...undefinedSimplifiedProps
	};

	return {
		...remainingData, // Include this first to avoid overwriting simplified props
		DateTime: dateTimeValue,
		OffsetTime: offsetValue,
		Title: titleValue,
		Keywords: keywordsValue
	};
});

/**
 * Object type extracted from {@link ExifReadableDataSimplifiedSchema}.
 */
type ExifReadableDataSimplified = z.infer<typeof ExifReadableDataSimplifiedSchema>;

const ExifExportSchema = z.object({
	path: z.string(),
	mimeType: z.string(),
	captureDateTime: z.custom<Date>(),
	timezone: z.string(),
	title: z.string().nullable(),
	latitude: z.number().nullable(),
	longitude: z.number().nullable(),
	altitude: z.number().nullable(),
	keywords: z.array(z.string().nullable())
});
/**
 * Represents a schema of simplified properties used to write metadata to a media file.
 * It consists of the following properties:
 * - path: Path to the file.
 * - mimeType: MIME type of file, used to determine whether the media is an image or a video.
 * - captureDateTime: JS Date representing the time of capture.
 * - timezone: Name of timezone in which the media was captured.
 * - title: Media description; nullable.
 * - latitude: GPS latitude where the media was captured; nullable.
 * - longitude: GPS longitude where the media was captured; nullable.
 * - altitude: GPS altitude where the media was captured; nullable.
 * - keywords: Array of keyword strings or null-values.
 *
 * It verifies only the path to ensure that the media exists on disk and assumes the remaining data
 * is valid. We expect the data to be coming from the database and, thus, must have been verified
 * when writing it to the database.
 */
const ExifWriteableDataSimplifiedSchema = ExifExportSchema.refine(
	async ({ path }) => (await fs.stat(path)).isFile(),
	'File does not exist.'
);

/**
 * Schema definition for writing Exif metadata.
 * Structurally, this is same as {@link ExifReadableDataSchema} but it is obtained by transforming
 * {@link ExifWriteableDataSimplifiedSchema}.
 *
 * SourceFile, MIMEType, ExifDateTimeProp, and ExifOffsetTimeProp are mandatory properties.
 * Remaining properties default to undefined.
 */
const ExifWriteableDataSchema = ExifWriteableDataSimplifiedSchema.transform(
	(metadata): ExifData => {
		// Get datetime strings
		const luxonDateTime = DateTime.fromJSDate(metadata.captureDateTime).setZone(metadata.timezone);
		const dateTimeStr = luxonDateTime.toFormat('yyyy:MM:dd HH:mm:ss');
		const dateTimeOffsetStr = luxonDateTime.toFormat('yyyy-MM-dd HH:mm:ssZZ');
		const offsetStr = luxonDateTime.toFormat('ZZ');
		const utcDateTimeStr = luxonDateTime.setZone('UTC').toFormat('yyyy-MM-dd HH:mm:ss');

		const keywords = metadata.keywords.filter((keyword) => keyword !== null);

		// Get GPS data
		const latitude = metadata.latitude ?? undefined;
		const longitude = metadata.longitude ?? undefined;
		const altitude = metadata.altitude ?? undefined;
		let coordinate: string | undefined = undefined;
		let latitudeRef: 'N' | 'S' | undefined = undefined;
		let longitudeRef: 'E' | 'W' | undefined = undefined;
		let altitudeRef: 0 | 1 | undefined = undefined;

		if (latitude && longitude) {
			coordinate = `${latitude} ${longitude}`;
			latitudeRef = latitude >= 0 ? 'N' : 'S';
			longitudeRef = longitude >= 0 ? 'E' : 'W';
			// Altitude is only applicable if both latitude and longitude are present
			if (altitude) {
				coordinate += ` ${altitude}`;
				altitudeRef = altitude >= 0 ? 0 : 1;
			}
		}

		// Store common Exif properties
		let exifData: ExifData = {
			SourceFile: metadata.path,
			MIMEType: metadata.mimeType,
			OffsetTime: offsetStr,
			OffsetTimeOriginal: offsetStr,
			OffsetTimeDigitized: offsetStr,
			Title: metadata.title ?? undefined,
			Description: metadata.title ?? undefined,
			XPTitle: metadata.title ?? undefined,
			ImageDescription: metadata.title ?? undefined,
			GPSLatitude: latitude,
			GPSLatitudeRef: latitudeRef,
			GPSLongitude: longitude,
			GPSLongitudeRef: longitudeRef,
			GPSAltitude: altitude,
			GPSAltitudeRef: altitudeRef
		};

		if (metadata.mimeType.startsWith('image/')) {
			// Store image specific Exif properties
			exifData = {
				...exifData,
				DateTimeOriginal: dateTimeStr,
				DateTimeCreated: dateTimeOffsetStr,
				CreateDate: dateTimeStr,
				Keywords: keywords,
				Subject: keywords,
				XPKeywords: isValueSet(keywords) ? keywords.join(';') : ''
			};
		} else {
			// Store video specific Exif properties
			exifData = {
				...exifData,
				'Quicktime:CreationDate': dateTimeOffsetStr,
				'Quicktime:DateTimeOriginal': dateTimeOffsetStr,
				TrackCreateDate: utcDateTimeStr,
				MediaCreateDate: utcDateTimeStr,
				CreateDate: utcDateTimeStr,
				Category: keywords,
				GPSCoordinates: coordinate
			};
		}

		return exifData;
	}
);

/* SECTION: Exported types */

/**
 * Object type extracted from {@link ExifWriteableDataSimplifiedSchema}.
 */
export type ExifWriteableDataSimplified = z.infer<typeof ExifWriteableDataSimplifiedSchema>;

/* SECTION: Local functions */

/**
 * Parses a given EXIF-formatted datetime string and returns a DateTime object if the format is valid.
 *
 * This function processes a date string in EXIF's standard format (e.g., "yyyy:MM:dd HH:mm:ss[+HH:mm]").
 * If the optional timezone offset is provided, it overwrites the timezone offset from the date string.
 * If the parsing succeeds, a valid DateTime object is returned; otherwise, it returns null.
 *
 * @param date - The date string in EXIF-compliant format to parse.
 * @param offset - An optional timezone offset string (e.g., "+02:00").
 * @returns The parsed DateTime object if it is valid, otherwise null.
 */
const parseExifDateTime = (date: string, offset?: string): DateTime<true> | null => {
	const groups = date.match(regexPatterns.exifDateTimeOptionalOffset);
	if (groups) {
		const date = groups[1];
		const time = groups[2];
		if (!offset) offset = groups[3];
		const dateFormat = `yyyy:MM:dd HH:mm:ss${offset ? 'ZZ' : ''}`;
		const datetime = DateTime.fromFormat(`${date} ${time}${offset ? offset : ''}`, dateFormat);
		return datetime.isValid ? datetime : null;
	}
	return null;
};

/**
 * Execute exiftool shell command to read a file's metadata.
 *
 * @param filePath File on which to run the command.
 * @param args Command arguments as parameter-value pairs.
 * @returns Exif data for all read-type properties present in the file.
 */
const execExiftoolReadCmd = async (filePath: string, args: ExifProp[]) => {
	try {
		// Format as space-separated -arg string
		const parsedArgs = args.map((arg) => `-${arg}`).join(' ');

		/*
		 * Exiftool options:
		 * -json: Output in JSON format
		 * -n: Numerical format for applicable properties
		 * -m: Ignore minor errors and warnings
		 */
		const cmd = `"${EXIFTOOL_PATH}" -json -n -m ${parsedArgs} "${filePath}"`;
		console.debug('[exiftool-wrapper.ts:execExiftoolReadCmd] Exiftool command:', cmd);
		const { stdout, stderr } = await execPromise(cmd);

		if (stderr) throw new Error(stderr);

		return JSON.parse(stdout);
	} catch (error) {
		console.error('[exiftool-wrapper.ts:execExiftoolReadCmd] Exiftool exec error:', error);
		return null;
	}
};

/**
 * Execute exiftool shell command to write metadata to file(s).
 * It doesn't validate whether the metadata was applied properly or not.
 *
 * @param dirPath Path to directory containing the images.
 * @param jsonPath Path to JSON file containing metadata in Exiftool-compatible format.
 * @returns True if command was executed successfully, otherwise false.
 */
const execExiftoolWriteCmd = async (dirPath: string, jsonPath: string) => {
	try {
		/*
		 * Exiftool options:
		 * -json: Read properties from JSON file
		 * -n: Numerical format for applicable properties
		 * -m: Ignore minor errors and warnings
		 * -overwrite_original: Don't create backup copy
		 */
		const cmd = `"${EXIFTOOL_PATH}" -json="${jsonPath}" -n -m -overwrite_original "${dirPath}"`;
		console.debug('[exiftool-wrapper.ts:execExiftoolWriteCmd] Exiftool command:', cmd);
		await execPromise(cmd);
		return true;
	} catch (error) {
		console.error('[exiftool-wrapper.ts:execExiftoolWriteCmd] Exiftool write error:', error);
		return false;
	}
};

/* SECTION: Exported functions */

/**
 * Get exif data from a file using exif properties.
 *
 * @param filePath File on which to run the command.
 * @param props List of {@link ExifProp} to fetch.
 * @returns Exif data with subset of requested properties which are present in the file.
 */
export const readExifProps = async (
	filePath: string,
	props: ExifProp[]
): Promise<ExifData | null> => {
	if (!(await fs.stat(filePath)).isFile()) {
		console.error('[exiftool-wrapper.ts:readExifProps] Invalid file path:', filePath);
		return null;
	}

	// Remove duplicates and include MIMEType
	const uniqueProps = props.filter(removeDuplicatesPredicate);
	if (!uniqueProps.includes('MIMEType')) uniqueProps.push('MIMEType');

	const cmdOutput = await execExiftoolReadCmd(filePath, uniqueProps);

	if (!Array.isArray(cmdOutput) || cmdOutput.length === 0) {
		console.error('[exiftool-wrapper.ts:readExifProps] Exiftool returned no results');
		return null;
	}

	try {
		return ExifReadableDataSchema.parse(cmdOutput[0]);
	} catch (error) {
		console.error('[exiftool-wrapper.ts:readExifProps] Zod error:', error);
		return null;
	}
};

/**
 * Get exif data in a simplified format. The following exif properties are merged into a single property:
 * - All properties in {@link ExifDateTimeProp} are merged into DateTime property.
 * - All properties in {@link ExifOffsetTimeProp} are merged into OffsetTime property.
 * - All properties in {@link ExifTitleProp} are merged into Title property.
 * - All properties in {@link ExifKeywordsProp} are merged into Keywords property.
 *
 * Remaining properties are included as is.
 *
 * @param filePath File on which to run the command.
 * @param props List of {@link ExifProp} to fetch.
 * @returns Simplified exif data with requested properties.
 */
export const readSimplifiedExifProps = async (
	filePath: string,
	props: ExifProp[]
): Promise<ExifReadableDataSimplified | null> => {
	// Include all related properties for each given property
	const extendedProps = props.flatMap((prop) => {
		if (ExifDateTimeProps.some((dateTimeProp) => prop === dateTimeProp)) return ExifDateTimeProps;
		if (ExifOffsetTimeProps.some((offsetTimeProp) => prop === offsetTimeProp))
			return ExifOffsetTimeProps;
		if (ExifTitleProps.some((titleProp) => prop === titleProp)) return ExifTitleProps;
		if (ExifKeywordsProps.some((keywordsProp) => prop === keywordsProp)) return ExifKeywordsProps;
		return [prop];
	});

	const exifData = await readExifProps(filePath, extendedProps);
	if (!exifData) return null;

	try {
		return ExifReadableDataSimplifiedSchema.parse(exifData);
	} catch (error) {
		console.error('[exiftool-wrapper.ts:readSimplifiedExifProps] Zod error:', error);
		return null;
	}
};

/**
 * Write exif data to files. All possible Exif properties are derived using the given metadata.
 *
 * @param exifWriteDataSimplified List of files and their metadata to be written.
 * @returns true if metadata was successfully written to the files, otherwise false.
 */
export const writeSimplifiedExifProps = async (
	exifWriteDataSimplified: ExifWriteableDataSimplified[]
) => {
	try {
		const metadata: ExifData[] = await Promise.all(
			exifWriteDataSimplified.map(async (data) => await ExifWriteableDataSchema.parseAsync(data))
		);
		console.debug('[exiftool-wrapper.ts:writeSimplifiedExifProps] Writing data:', metadata);

		// Keep this file after writing metadata for future reference
		const metadataJsonPath = path.join(FILE_UPLOAD_DIR, 'metadata.json');
		await fs.writeFile(metadataJsonPath, JSON.stringify(metadata));
		return await execExiftoolWriteCmd(FILE_UPLOAD_DIR, metadataJsonPath);
		// TODO add verification mechanism to check whether metadata was properly applied
	} catch (error) {
		console.error('[exiftool-wrapper.ts:writeSimplifiedExifProps]', error);
		return false;
	}
};

/**
 * Generates a file containing the exif metadata.
 *
 * @param exifWriteDataSimplified List of files and their metadata to be generated
 * @returns Path to the metadata file
 */
export const exportExifData = async (exifWriteDataSimplified: ExifWriteableDataSimplified[]) => {
	try {
		const metadata: ExifData[] = exifWriteDataSimplified.map((data) =>
			ExifExportSchema.parse(data)
		);
		console.debug('[exiftool-wrapper.ts:exportExifData] Total files:', metadata.length);

		const metadataJsonPath = path.join(FILE_UPLOAD_DIR, 'metadata.json');
		await fs.writeFile(metadataJsonPath, JSON.stringify(metadata, null, 4));

		return metadataJsonPath;
	} catch (error) {
		console.error('[exiftool-wrapper.ts:exportExifData]', error);
		return false;
	}
};
