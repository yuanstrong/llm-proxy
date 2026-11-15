import * as fs from 'node:fs';
import * as path from 'node:path';
import * as zlib from 'node:zlib';
import type { PromptHistoryEntry } from '../types';

export const HISTORY_ROTATION_HOUR = 3;
const ROTATION_CHECK_INTERVAL_MS = 60_000;
const ARCHIVE_FILE_PATTERN = /^(.*)_(\d{4}-\d{2}-\d{2})\.jsonl\.gz$/;
const lastRotationDate = new Map<string, string>();

export function localDateString(value: Date): string {
  const month = String(value.getMonth() + 1).padStart(2, '0');
  const day = String(value.getDate()).padStart(2, '0');
  return `${value.getFullYear()}-${month}-${day}`;
}

export function entryDateString(timestamp: string): string | undefined {
  const date = new Date(timestamp);
  return Number.isNaN(date.getTime()) ? undefined : localDateString(date);
}

export function historyFilePath(directory: string, provider: string): string {
  return path.join(directory, `${provider}.jsonl`);
}

export function archiveFilePath(directory: string, provider: string, date: string): string {
  return path.join(directory, `${provider}_${date}.jsonl.gz`);
}

function readTextLines(filePath: string): string[] {
  try {
    return fs.readFileSync(filePath, 'utf8').split(/\r?\n/).filter((line) => line.trim().length > 0);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw error;
  }
}

function readArchiveLines(filePath: string): string[] {
  try {
    return zlib.gunzipSync(fs.readFileSync(filePath))
      .toString('utf8')
      .split(/\r?\n/)
      .filter((line) => line.trim().length > 0);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw error;
  }
}

export function readHistoryLines(filePath: string): string[] {
  return filePath.endsWith('.gz') ? readArchiveLines(filePath) : readTextLines(filePath);
}

export function isPromptHistoryEntry(value: unknown): value is PromptHistoryEntry {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<PromptHistoryEntry>;
  return typeof candidate.timestamp === 'string'
    && typeof candidate.provider === 'string'
    && typeof candidate.format === 'string'
    && typeof candidate.prompt === 'string'
    && typeof candidate.response === 'string'
    && typeof candidate.status === 'number'
    && typeof candidate.durationMs === 'number';
}

function writeFileAtomic(filePath: string, data: Buffer | string): void {
  const temporaryPath = `${filePath}.tmp-${process.pid}`;
  fs.writeFileSync(temporaryPath, data);
  fs.renameSync(temporaryPath, filePath);
}

function lineTimestamp(line: string): string {
  try {
    const parsed: unknown = JSON.parse(line);
    if (parsed && typeof parsed === 'object') {
      const timestamp = (parsed as { timestamp?: unknown }).timestamp;
      if (typeof timestamp === 'string') return timestamp;
    }
  } catch {
    // Keep unparsable lines in append order.
  }
  return '';
}

function appendArchive(directory: string, provider: string, date: string, lines: string[]): void {
  const filePath = archiveFilePath(directory, provider, date);
  const merged = [...new Set([...readArchiveLines(filePath), ...lines])];
  merged.sort((left, right) => lineTimestamp(left).localeCompare(lineTimestamp(right)));
  writeFileAtomic(filePath, zlib.gzipSync(`${merged.join('\n')}\n`));
}

/**
 * Moves every entry older than the current local day into
 * `<provider>_<date>.jsonl.gz`, leaving the current day in `<provider>.jsonl`.
 */
export function rotateHistory(directory: string, provider: string, now = new Date()): string[] {
  const today = localDateString(now);
  const currentPath = historyFilePath(directory, provider);
  const lines = readTextLines(currentPath);
  if (lines.length === 0) return [];

  const keep: string[] = [];
  const archived = new Map<string, string[]>();
  for (const line of lines) {
    const timestamp = lineTimestamp(line);
    const date = timestamp ? entryDateString(timestamp) : undefined;
    if (!date || date >= today) {
      keep.push(line);
      continue;
    }
    const bucket = archived.get(date);
    if (bucket) bucket.push(line);
    else archived.set(date, [line]);
  }

  const archivedDates = [...archived.keys()].sort();
  if (archivedDates.length === 0) return [];
  for (const date of archivedDates) {
    appendArchive(directory, provider, date, archived.get(date) ?? []);
  }
  writeFileAtomic(currentPath, keep.length > 0 ? `${keep.join('\n')}\n` : '');
  return archivedDates;
}

/**
 * Rotates at most once per local day, and only after the 3am cutoff.
 */
export function rotateHistoryIfDue(directory: string, provider: string, now = new Date()): boolean {
  if (now.getHours() < HISTORY_ROTATION_HOUR) return false;
  const today = localDateString(now);
  const key = `${directory}\u0000${provider}`;
  if (lastRotationDate.get(key) === today) return false;
  rotateHistory(directory, provider, now);
  lastRotationDate.set(key, today);
  return true;
}

/**
 * Checks once a minute so a running provider rotates even without traffic.
 */
export function startHistoryRotation(directory: string, provider: string): () => void {
  const tick = (): void => {
    try {
      rotateHistoryIfDue(directory, provider);
    } catch {
      // Rotation must never break proxying.
    }
  };
  tick();
  const timer = setInterval(tick, ROTATION_CHECK_INTERVAL_MS);
  return () => clearInterval(timer);
}

export function listPromptHistoryDates(directory: string, provider?: string, now = new Date()): string[] {
  const dates = new Set<string>([localDateString(now)]);
  let files: string[];
  try {
    files = fs.readdirSync(directory);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [...dates].sort();
    throw error;
  }
  for (const file of files) {
    const match = ARCHIVE_FILE_PATTERN.exec(file);
    if (!match) continue;
    if (provider && match[1] !== provider) continue;
    dates.add(match[2]);
  }
  return [...dates].sort();
}
