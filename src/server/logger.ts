import { Writable } from 'node:stream';
import { createLogger as createWinstonLogger, format, transports, type Logger as WinstonLogger } from 'winston';
import type { LogLevel } from '../types';

export type LogWriter = (level: LogLevel, message: string) => void;
export type Logger = WinstonLogger;

const LOG_LINE = /^\[(debug|info|warn|error)\] (.*)$/;

function createWriterTransport(write: LogWriter): transports.StreamTransportInstance {
  const stream = new Writable({
    write(chunk, _encoding, callback) {
      const line = chunk.toString().trimEnd();
      const match = line.match(LOG_LINE);
      if (match) write(match[1] as LogLevel, match[2]);
      callback();
    },
  });
  return new transports.Stream({ stream });
}

export function createLogger(level: LogLevel = 'info', write?: LogWriter): Logger {
  return createWinstonLogger({
    level,
    format: format.printf(({ level: messageLevel, message }) => `[${messageLevel}] ${String(message)}`),
    transports: write
      ? [createWriterTransport(write)]
      : [new transports.Console({ stderrLevels: ['error'] })],
  });
}
