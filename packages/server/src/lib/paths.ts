/**
 * Centralized path constants for the Handler server.
 * All data storage paths derive from DATA_DIR to keep everything under {PROJECT_ROOT}/data/.
 */

import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

/** Root of the monorepo (the `app/` directory) */
export const PROJECT_ROOT = join(__dirname, '..', '..', '..', '..');

/** Base data directory — all runtime data lives here */
export const DATA_DIR = join(PROJECT_ROOT, 'data');
