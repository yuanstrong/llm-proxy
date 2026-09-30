import type { LogLevel } from '../types';

const LOG_LEVEL_PRIORITY: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

export type LogWriter = (level: LogLevel, message: string) => void;

export interface Logger {
  debug(message: string): void;
  info(message: string): void;
  warn(message: string): void;
  error(message: string): void;
}

function defaultWriter(level: LogLevel, message: string): void {
  const line = `[${level}] ${message}`;
  if (level === 'error') {
    console.error(line);
  } else if (level === 'warn') {
    console.warn(line);
  } else {
    console.log(line);
  }
}

export function createLogger(level: LogLevel = 'info', write: LogWriter = defaultWriter): Logger {
  const threshold = LOG_LEVEL_PRIORITY[level] ?? LOG_LEVEL_PRIORITY.info;
  const log = (messageLevel: LogLevel, message: string): void => {
    if (LOG_LEVEL_PRIORITY[messageLevel] >= threshold) write(messageLevel, message);
  };

  return {
    debug: (message) => log('debug', message),
    info: (message) => log('info', message),
    warn: (message) => log('warn', message),
    error: (message) => log('error', message),
  };
}
