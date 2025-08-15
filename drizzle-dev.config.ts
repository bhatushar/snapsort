import { defineConfig } from 'drizzle-kit';
import * as process from 'node:process';
import dotenv from 'dotenv';

dotenv.config({ path: '.env.development' });

if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is not set');
console.log('[drizzle.config.ts] DB URL:', process.env.DATABASE_URL);

export default defineConfig({
	schema: './src/lib/server/db/schema.ts',
	dbCredentials: { url: process.env.DATABASE_URL },
	verbose: true,
	strict: true,
	dialect: 'sqlite'
});
