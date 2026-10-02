import assert from 'node:assert/strict';
import test from 'node:test';
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
