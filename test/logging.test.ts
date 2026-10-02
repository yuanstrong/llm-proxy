import assert from 'node:assert/strict';
import test from 'node:test';
import { threadId } from 'node:worker_threads';
import { createLogger } from '../src/server/logger';

test('provider logger filters messages below the configured log level', () => {
  const entries: Array<{ level: string; message: string }> = [];
  const logger = createLogger('warn', (level, message) => entries.push({ level, message }));

  assert.equal(typeof logger.on, 'function');
  assert.ok(Array.isArray(logger.transports));

  logger.debug('debug message');
  logger.info('info message');
  logger.warn('warn message');
  logger.error('error message');

  assert.deepEqual(entries, [
    { level: 'warn', message: 'warn message' },
    { level: 'error', message: 'error message' },
  ]);
});

test('provider logger formats timestamp, process id, thread id, level, and message', () => {
  const logger = createLogger();
  const info = logger.format.transform({ level: 'info', message: 'formatted message' });
  const formatted = info[Symbol.for('message')];

  assert.match(
    formatted,
    new RegExp(
      `^\\d{4}-\\d{2}-\\d{2} \\d{2}:\\d{2}:\\d{2}\\.\\d{3} \\[(?:PID):${process.pid}\\] \\[(?:TID):${threadId}\\] \\[INFO\\] formatted message$`,
    ),
  );
});
