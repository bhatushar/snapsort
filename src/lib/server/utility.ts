import { exec } from 'child_process';
import { promisify } from 'util';
import sharp from 'sharp';
import { FFMPEG_PATH } from '$env/static/private';

export const execPromise = promisify(exec);

type VideoToGifOpts = {
	fps: number;
	width: number;
};

/**
 * Generate an image thumbnail from an image buffer.
 *
 * @param imageBuffer
 * @param outPath
 * @throws Error If thumbnail generation fails.
 */
export async function imageThumbnail(imageBuffer: Buffer, outPath: string) {
	await sharp(imageBuffer)
		.resize(320)
		.withMetadata() // Preserve metadata for correct orientation
		.jpeg()
		.toFile(outPath);
}

/**
 * Generate a GIF from a video file.
 *
 * @param videoPath
 * @param outPath
 * @param opts
 * @throws Error If GIF generation fails.
 */
export async function videoToGif(
	videoPath: string,
	outPath: string,
	opts: VideoToGifOpts = { fps: 3, width: 200 }
) {
	if (!FFMPEG_PATH) {
		throw new Error('FFMPEG not found.');
	}

	/*
		Use ffmpeg to generate a GIF from a video with following parameters:
		- fps sets the frame rate.
		- scale sets the pixel width of the output GIF. Height is auto-determined (-1).
		- lanczos is the scaling algorithm.
		- split allows one-shot GIF generation without storing intermediate PNGs.
		- palettegen and paletteuse control the colors.
		- loop infinitely.
		FFMPEG ref: https://superuser.com/a/556031
		TODO find better alternatives for generating video thumbnails.
	 */
	const { stderr } = await execPromise(
		`"${FFMPEG_PATH}" -i "${videoPath}" ` +
			`-vf "fps=${opts.fps},scale=${opts.width}:-1:flags=lanczos,` +
			`split[s0][s1];[s0]palettegen[p];[s1][p]paletteuse" ` +
			`-loop 0 -loglevel error ${outPath}`
	);

	if (stderr) {
		throw new Error(`[utility.ts:videoToGif] ffmpeg error: ${stderr}`);
	}
}
