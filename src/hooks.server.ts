import fs from 'fs/promises';
import { FILE_UPLOAD_DIR, LIBRARY_ROOT_DIR } from '$env/static/private';
import path from 'path';
import { type Handle, redirect } from '@sveltejs/kit';
import jwt from 'jsonwebtoken';
import { env } from '$env/dynamic/private';

// Create the necessary directories on server start
const appDirs = [FILE_UPLOAD_DIR, path.join(FILE_UPLOAD_DIR, 'thumb'), LIBRARY_ROOT_DIR];
await Promise.all(appDirs.map(async (dir) => await fs.mkdir(dir, { recursive: true })));

// Generate random JWT secret on app start
env.JWT_SECRET_KEY = crypto
	.getRandomValues(new Uint8Array(32))
	.reduce((hexString: string, byte: number) => {
		const hex = byte.toString(16);
		return hexString + (hex.length === 2 ? hex : '0' + hex);
	}, '');

export const handle: Handle = async ({ event, resolve }) => {
	// Validate auth token and redirect accordingly
	const token = event.cookies.get('auth-token');
	let jwtVerified = false;

	try {
		const jwtPayload = token ? jwt.verify(token, env.JWT_SECRET_KEY as string) : undefined;
		if (jwtPayload) jwtVerified = true;
	} catch (error) {
		console.error('[hooks.server.ts:handle] auth error:', error);
	}

	// Cannot access the login page if already signed in
	if (jwtVerified && event.url.pathname.startsWith('/login')) redirect(307, '/');
	// Cannot access projected routes if not signed in
	if (!jwtVerified && !event.url.pathname.startsWith('/login')) redirect(307, '/login');

	return resolve(event);
};
