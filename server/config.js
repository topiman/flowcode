import { resolve, join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

export const DASHBOARD_DIR = resolve(__dirname, '..');
export const PROJECTS_DIR = join(DASHBOARD_DIR, 'projects');
export const PORT = 3210;
