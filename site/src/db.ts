import { PrismaClient } from '@prisma/client';
import { config } from './config';

/**
 * The site reads the same database as the API, through the batoma_site role: SELECT on
 * published or verified rows only (row-level security), and INSERT on site_events alone.
 * Nothing in this service can change the magazine, the fleet or anyone's account.
 */
export const db = new PrismaClient({ log: ['error'], ...(config.databaseUrl ? { datasources: { db: { url: config.databaseUrl } } } : {}) });
