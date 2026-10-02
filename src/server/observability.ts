import * as fs from 'node:fs';
import * as path from 'node:path';
import type { LogEntry, LogLevel, PromptHistoryEntry } from '../types';

const LOG_LEVELS: LogLevel[] = ['debug', 'info', 'warn', 'error'];
const TIMESTAMPED_LOG_LINE = /^\[([^\]]+)\]\s+\[([^\]]+)\]\s+\[([^\]]+)\]\s+(.*)$/;
const LOG_LINE = /^\[([^\]]+)\]\s+\[([^\]]+)\]\s+(.*)$/;

function listFiles(directory: string, suffix: string): string[] {
  try {
    return fs.readdirSync(directory)
      .filter((file) => file.endsWith(suffix))
      .map((file) => path.join(directory, file));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw error;
  }
}

export function readLogEntries(
  directory: string,
  filters: { provider?: string; level?: LogLevel; limit: number },
): LogEntry[] {
  const entries: LogEntry[] = [];
  for (const filePath of listFiles(directory, '.log')) {
    const fileProvider = path.basename(filePath, '.log');
    let content: string;
    try {
      content = fs.readFileSync(filePath, 'utf8');
    } catch {
      continue;
    }
    for (const line of content.split(/\r?\n/)) {
      if (!line.trim()) continue;
      const timestampedMatch = line.match(TIMESTAMPED_LOG_LINE);
      const simpleMatch = line.match(LOG_LINE);
      if (!timestampedMatch && !simpleMatch) continue;
      const timestamp = timestampedMatch?.[1];
      const providerFromLine = timestampedMatch?.[2] ?? simpleMatch?.[1];
      const rawLevel = timestampedMatch?.[3] ?? simpleMatch?.[2];
      const message = timestampedMatch?.[4] ?? simpleMatch?.[3] ?? '';
      if (!LOG_LEVELS.includes(rawLevel as LogLevel)) continue;
      const provider = providerFromLine || fileProvider;
      const level = rawLevel as LogLevel;
      if (filters.provider && filters.provider !== provider) continue;
      if (filters.level && filters.level !== level) continue;
      entries.push({
        ...(timestamp ? { timestamp } : {}),
        provider,
        level,
        message,
      });
    }
  }
  return entries.slice(-filters.limit).reverse();
}

function isHistoryEntry(value: unknown): value is PromptHistoryEntry {
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

export function readPromptHistory(
  directory: string,
  filters: { provider?: string; limit: number },
): PromptHistoryEntry[] {
  const entries: PromptHistoryEntry[] = [];
  for (const filePath of listFiles(directory, '.jsonl')) {
    let content: string;
    try {
      content = fs.readFileSync(filePath, 'utf8');
    } catch {
      continue;
    }
    for (const line of content.split(/\r?\n/)) {
      if (!line.trim()) continue;
      try {
        const parsed: unknown = JSON.parse(line);
        if (!isHistoryEntry(parsed)) continue;
        if (filters.provider && parsed.provider !== filters.provider) continue;
        entries.push(parsed);
      } catch {
        // A partial final line should not make the history endpoint unavailable.
      }
    }
  }
  return entries
    .sort((left, right) => right.timestamp.localeCompare(left.timestamp))
    .slice(0, filters.limit);
}
