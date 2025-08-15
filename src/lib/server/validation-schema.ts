import { z } from 'zod';

/**
 * Schema for password validation.
 */
export const PasswordSchema = z.string().min(1, 'Password cannot be empty.');
