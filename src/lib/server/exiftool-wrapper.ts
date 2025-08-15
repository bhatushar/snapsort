import fs from 'fs/promises';
import { EXIFTOOL_PATH, FILE_UPLOAD_DIR } from '$env/static/private';
import { DateTime } from 'luxon';
import { z } from 'zod';
import path from 'path';
import ianaTz from '$lib/iana-tz.json';
import type { FileData } from '$lib/types';
import { execPromise } from '$lib/server/utility';

/* SECTION: Exif properties */

/*
 * NOTE ON EXIF PROPERTY TYPES:
 * Exif property union is derived from const arrays. This enforces a priority order between property
 * groups. Property present at a lower index in the array takes precedence over a property present
 * at a higher index.
 */

/**
 * Exif properties related to the date and time at which an image/video was captured.
 */
const ExifDateTimeProps = [
	'DateTimeCreated', // yyyy:mm:dd HH:MM:SS+hh:mm (captured timezone offset, only for images)
	'Quicktime:CreationDate', // yyyy:mm:dd HH:MM:SS+hh:mm (captured timezone offset, only for videos)
	'Quicktime:DateTimeOriginal', // yyyy:mm:dd HH:MM:SS+hh:mm (captured timezone offset, only for videos)
	'DateTimeOriginal', // yyyy:mm:dd HH:MM:SS (captured timezone offset, only for images)
	'TrackCreateDate', // yyyy:mm:dd HH:MM:SS (UTC offset, only for video)
	'MediaCreateDate', // yyyy:mm:dd HH:MM:SS (UTC offset, only for video)
	'CreateDate' // yyyy:mm:dd HH:MM:SS (captured timezone offset for images, UTC offset for videos)
] as const;

/**
 * Exif properties related to the timezone offset of an image/video.
 */
const ExifOffsetTimeProps = ['OffsetTime', 'OffsetTimeOriginal', 'OffsetTimeDigitized'] as const;

/**
 * Exif properties related to the title/description of an image/video.
 */
const ExifTitleProps = ['Title', 'Description', 'XPTitle', 'ImageDescription'] as const;

/**
 * Exif properties related to the keywords present in an image/video.
 */
const ExifKeywordsProps = [
	'Category', // ["tag1", "tag2"] or "tag" (only for videos)
	'Keywords', // ["tag1", "tag2"] or "tag" (only for images)
	'Subject', // ["tag1", "tag2"] or "tag" (only for images)
	'XPKeywords' // "tag1;tag2" (only for images)
] as const;

/**
 * Properties stored in a file's exif data. These are used as arguments to exiftool command.
 * This is an incomplete list and doesn't contain all the exif properties in existence, only the
 * ones relevant to this project.
 */
const ExifProps = [
	'MIMEType', // image/* or video/*
	'GPSLatitude', // number, inclusive range from -90 to 90
	'GPSLatitudeRef', // string, N for positive latitude, S for negative latitude
	'GPSLongitude', // number, inclusive range from -180 to 180
	'GPSLongitudeRef', // string, E for positive longitude, W for negative longitude
	'GPSAltitude', // number, positive for above sea-level, negative for below sea-level
	'GPSAltitudeRef', // number, 0 for above sea-level, 1 for below sea-level
	'GPSCoordinates', // "latitude longitude altitude" (only for videos)
	...ExifDateTimeProps,
	...ExifOffsetTimeProps,
	...ExifTitleProps,
	...ExifKeywordsProps
];

/**
 * Union of all supported Exif properties.
 */
type ExifProp = (typeof ExifProps)[number];

/* SECTION: Exif data validation schemas */

const regexPatterns = {
	exifDateTime: /^(\d{4}:\d{2}:\d{2}) (\d{2}:\d{2}:\d{2})$/, // yyyy:mm:dd HH:MM
	exifDateTimeOffset: /^(\d{4}:\d{2}:\d{2}) (\d{2}:\d{2}:\d{2})([+-]\d{2}:\d{2})$/, // yyyy:dd:mm HH:MM+HH:SS
	exifTimezoneOffset: /^([+-]\d{2}:\d{2})$/, // +HH:SS
	exifDateTimeOptionalOffset: /^(\d{4}:\d{2}:\d{2}) (\d{2}:\d{2}:\d{2})([+-]\d{2}:\d{2})?$/, // yyyy:dd:mm HH:MM[+HH:SS]
	gpsCoordinates: /^([+-]?\d{1,2}(?:\.\d+)?) ([+-]?\d{1,3}(?:\.\d*)?)(?: ([+-]?\d+(?:\.\d+)?))?$/ // latitude longitude [altitude]
};

/**
 * Schema definition for extracting and validating Exif metadata.
 * This schema stores the Exif data in Exiftool-compatible format while enforcing validation
 * constraints on various properties.
 *
 * SourceFile and MIMEType are the only mandatory properties. Remaining properties default to
 * undefined and do not throw any errors if validation fails.
 */
const ExifDataSchema = z.object({
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
 * Object type extracted from {@link ExifDataSchema}.
 */
type ExifData = z.infer<typeof ExifDataSchema>;

/* SECTION: Local functions */

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

		if (stderr) {
			console.error('[exiftool-wrapper.ts:execExiftoolReadCmd] Exiftool error:', stderr);
			return null;
		}

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
 * @param dirPath Path to directory containing all the images/videos.
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
		console.error('[exiftool-wrapper.ts:execExiftoolWriteCmd] Exiftool exec error:', error);
		return false;
	}
};

/**
 * Parses a given EXIF-formatted datetime string and returns a DateTime object if the format is valid.
 *
 * This function processes a datetime string in EXIF's standard format (e.g., "yyyy:MM:dd HH:mm:ss[+HH:mm]").
 * If the optional timezone offset is provided, it overwrites the timezone offset from the datetime string.
 * If the parsing succeeds, a valid DateTime object is returned; otherwise, it returns null.
 *
 * @param dateTime - The datetime string in EXIF-compliant format to parse.
 * @param offset - An optional timezone offset string (e.g., "+02:00").
 * @returns The parsed DateTime object if it is valid, otherwise null.
 */
const parseExifDateTime = (dateTime: string, offset?: string): DateTime<true> | null => {
	const groups = dateTime.match(regexPatterns.exifDateTimeOptionalOffset);
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
 * Determines the IANA timezone name from an EXIF timezone offset string.
 *
 * This function attempts to find the most appropriate IANA timezone based on a given offset:
 * - If the current system timezone matches the provided offset, it returns the current timezone
 * - Otherwise, it returns the first IANA timezone that matches the provided offset
 *
 * @param offset - An optional timezone offset string (e.g., "+02:00")
 * @returns The IANA timezone name (e.g., "Europe/Berlin")
 */
const getTimezoneFromOffset = (offset: string | undefined): string => {
	let zoneName = DateTime.local().zoneName;

	if (offset) {
		const localZone = ianaTz.find((tz) => tz.zone === zoneName);
		if (localZone?.utcOffset.std !== offset) {
			// The current timezone does not match the provided offset
			// Find the first timezone which matches the provided offset
			const tz = ianaTz.find((tz) => tz.utcOffset.std === offset);
			if (tz) zoneName = tz.zone;
		}
	}

	return zoneName;
};

/**
 * Converts an {@link ExifData} object to a {@link FileData} object for internal application use.
 *
 * This function transforms the raw metadata extracted from a file using exiftool ({@link ExifData}) into
 * the application's internal file metadata representation ({@link FileData}). It handles:
 * - Extracting and parsing date/time information with timezone offsets
 * - Processing title/description metadata from various possible EXIF fields
 * - Extracting keywords/tags from different metadata formats
 * - Collecting GPS coordinates (latitude, longitude, altitude)
 *
 * @param exifData - The raw metadata extracted from a file using exiftool
 * @returns A {@link FileData} object containing the processed metadata in the application's internal format
 */
const convertExifToFileData = (exifData: ExifData): FileData => {
	let captureDateTime: Date | null = null;
	let captureOffset: string | undefined = undefined;
	let title: string | null = null;
	let keywords: string[] = [];

	// Extract datetime and offset info
	const dateTimeProp = ExifDateTimeProps.find((prop) => exifData[prop] !== undefined);
	if (dateTimeProp && exifData[dateTimeProp]) {
		const offsetProp = ExifOffsetTimeProps.find((prop) => exifData[prop] !== undefined);
		captureOffset = offsetProp && exifData[offsetProp];

		if (
			exifData.MIMEType.startsWith('image/') ||
			dateTimeProp === 'Quicktime:CreationDate' ||
			dateTimeProp === 'Quicktime:DateTimeOriginal'
		) {
			// DateTime string is relative to the original timezone
			const luxonDateTime = parseExifDateTime(exifData[dateTimeProp], captureOffset);
			if (luxonDateTime) captureDateTime = luxonDateTime.toJSDate();
		} else {
			// DateTime string is relative to the UTC timezone
			const luxonDateTime = parseExifDateTime(exifData[dateTimeProp], '+00:00');
			if (luxonDateTime) captureDateTime = luxonDateTime.toJSDate();
		}
	}
	const timezone = getTimezoneFromOffset(captureOffset);

	// Extract title info
	const titleProp = ExifTitleProps.find((prop) => exifData[prop] !== undefined);
	if (titleProp && exifData[titleProp]) title = exifData[titleProp];

	// Extract keyword info
	const keywordsProp = ExifKeywordsProps.find((prop) => exifData[prop] !== undefined);
	if (keywordsProp && exifData[keywordsProp]) {
		keywords =
			keywordsProp === 'XPKeywords' ? exifData[keywordsProp].split(';') : exifData[keywordsProp];
	}

	return {
		path: exifData.SourceFile,
		mimeType: exifData.MIMEType,
		captureDateTime,
		timezone,
		title,
		latitude: exifData.GPSLatitude ?? null,
		longitude: exifData.GPSLongitude ?? null,
		altitude: exifData.GPSAltitude ?? null,
		keywords
	};
};

/**
 * Converts a {@link FileData} object to an {@link ExifData} object suitable for writing to a file using exiftool.
 *
 * This function transforms the application's internal file metadata representation ({@link FileData}) into
 * the format expected by exiftool ({@link ExifData}). It handles:
 * - Verifying the file exists on disk
 * - Formatting date/time information with proper timezone offsets
 * - Processing GPS coordinates with appropriate reference values (N/S, E/W)
 * - Setting altitude data with reference values (above/below sea level)
 * - Applying different metadata properties based on whether the file is an image or video
 *
 * @param fileData - The file metadata in the application's internal format
 * @returns A Promise that resolves to an {@link ExifData} object ready for writing with exiftool
 * @throws Error if the specified file does not exist on disk
 */
const convertFileToExifData = async (fileData: FileData): Promise<ExifData> => {
	let dateTime: string | undefined = undefined;
	let offset: string | undefined = undefined;
	let dateTimeOffset: string | undefined = undefined;
	let utcDateTime: string | undefined = undefined;

	if (!(await fs.stat(fileData.path)).isFile())
		throw new Error(`File does not exist: ${fileData.path}`);

	// Get datetime strings
	if (fileData.captureDateTime) {
		const luxonDateTime = DateTime.fromJSDate(fileData.captureDateTime).setZone(fileData.timezone);
		dateTime = luxonDateTime.toFormat('yyyy:MM:dd HH:mm:ss');
		offset = luxonDateTime.toFormat('ZZ');
		dateTimeOffset = luxonDateTime.toFormat('yyyy-MM-dd HH:mm:ssZZ');
		utcDateTime = luxonDateTime.setZone('UTC').toFormat('yyyy-MM-dd HH:mm:ss');
	}

	// Get GPS data
	const latitude = fileData.latitude ?? undefined;
	const longitude = fileData.longitude ?? undefined;
	const altitude = fileData.altitude ?? undefined;
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
		SourceFile: fileData.path,
		MIMEType: fileData.mimeType,
		OffsetTime: offset,
		OffsetTimeOriginal: offset,
		OffsetTimeDigitized: offset,
		Title: fileData.title ?? undefined,
		Description: fileData.title ?? undefined,
		XPTitle: fileData.title ?? undefined,
		ImageDescription: fileData.title ?? undefined,
		GPSLatitude: latitude,
		GPSLatitudeRef: latitudeRef,
		GPSLongitude: longitude,
		GPSLongitudeRef: longitudeRef,
		GPSAltitude: altitude,
		GPSAltitudeRef: altitudeRef
	};

	if (fileData.mimeType.startsWith('image/')) {
		// Store image specific Exif properties
		exifData = {
			...exifData,
			DateTimeOriginal: dateTime,
			DateTimeCreated: dateTimeOffset,
			CreateDate: dateTime,
			Keywords: fileData.keywords,
			Subject: fileData.keywords,
			XPKeywords: fileData.keywords.join(';')
		};
	} else {
		// Store video specific Exif properties
		exifData = {
			...exifData,
			'Quicktime:CreationDate': dateTimeOffset,
			'Quicktime:DateTimeOriginal': dateTimeOffset,
			TrackCreateDate: utcDateTime,
			MediaCreateDate: utcDateTime,
			CreateDate: utcDateTime,
			Category: fileData.keywords,
			GPSCoordinates: coordinate
		};
	}

	return exifData;
};

/**
 * Get exif data from a file using exif properties.
 *
 * @param filePath File on which to run the command.
 * @param props List of {@link ExifProp} to fetch.
 * @returns Exif data with subset of requested properties which are present in the file.
 */
const readExifProps = async (filePath: string, props: ExifProp[]): Promise<ExifData | null> => {
	if (!(await fs.stat(filePath)).isFile()) {
		console.error('[exiftool-wrapper.ts:readExifProps] File does not exist:', filePath);
		return null;
	}

	const cmdOutput = await execExiftoolReadCmd(filePath, props);

	if (!Array.isArray(cmdOutput) || cmdOutput.length === 0) {
		console.error('[exiftool-wrapper.ts:readExifProps] Exiftool returned no results');
		return null;
	}

	try {
		return ExifDataSchema.parse(cmdOutput[0]);
	} catch (error) {
		console.error('[exiftool-wrapper.ts:readExifProps] Zod error:', error);
		return null;
	}
};

/* SECTION: Exported functions */

/**
 * Get file metadata from the Exif properties.
 *
 * @param filePath Path of the file to read Exif data from.
 * @returns Metadata of the file.
 */
export const getExifMetadata = async (filePath: string): Promise<FileData | null> => {
	const exifData = await readExifProps(filePath, ExifProps);
	if (!exifData) return null;

	return convertExifToFileData(exifData);
};

/**
 * Write Exif data to files. All possible Exif properties are derived using the given metadata.
 *
 * @param fileData List of files and their metadata to be written.
 * @returns true if metadata was successfully written to the files, otherwise false.
 */
export const applyExifMetadata = async (fileData: FileData[]) => {
	try {
		const exifData: ExifData[] = await Promise.all(
			fileData.map(async (file) => convertFileToExifData(file))
		);
		console.debug('[exiftool-wrapper.ts:writeExifMetadata] Writing data:', exifData);

		// Keep this file after writing metadata for future reference
		const metadataJsonPath = path.join(FILE_UPLOAD_DIR, 'metadata.json');
		await fs.writeFile(metadataJsonPath, JSON.stringify(exifData));
		return await execExiftoolWriteCmd(FILE_UPLOAD_DIR, metadataJsonPath);
		// TODO add verification mechanism to check whether metadata was properly applied
	} catch (error) {
		console.error('[exiftool-wrapper.ts:writeExifMetadata]', error);
		return false;
	}
};

/**
 * Generates a file containing the exif metadata.
 *
 * @param fileData List of files and their metadata to be generated
 * @returns Path to the metadata file
 */
export const exportExifData = async (fileData: FileData[]) => {
	try {
		const exifData: ExifData[] = await Promise.all(
			fileData.map(async (file) => convertFileToExifData(file))
		);
		console.debug('[exiftool-wrapper.ts:exportExifData] Total files:', exifData.length);

		const metadataJsonPath = path.join(FILE_UPLOAD_DIR, 'metadata.json');
		await fs.writeFile(metadataJsonPath, JSON.stringify(exifData, null, 4));

		return metadataJsonPath;
	} catch (error) {
		console.error('[exiftool-wrapper.ts:exportExifData]', error);
		return false;
	}
};
