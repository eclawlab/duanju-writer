import { join } from 'node:path';
import { homedir } from 'node:os';

export const VERSION = '0.0.2';
export const NAME = 'story_writer';
export const DATA_DIR = join(process.env.HOME || homedir(), '.story_writer');
export const CONFIG_FILE = join(DATA_DIR, 'config.json');
export const JOBS_FILE = join(DATA_DIR, 'jobs.json');
export const HISTORY_FILE = join(DATA_DIR, 'history.json');
export const JOBS_DIR = join(DATA_DIR, 'jobs');
export const DEFAULT_HEARTBEAT_INTERVAL = 1800000; // 30 minutes
export const CLAUDE_TIMEOUT = 300000; // 5 minutes
export const MAX_RETRIES = 3;
export const WORKER_POLL_INTERVAL = 5000; // 5 seconds
