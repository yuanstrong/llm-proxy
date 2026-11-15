import assert from 'node:assert/strict';
import { access, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import * as zlib from 'node:zlib';
import test from 'node:test';
import os from 'node:os';
import path from 'node:path';
import {
  archiveFilePath,
  historyFilePath,
  listPromptHistoryDates,
  rotateHistory,
  rotateHistoryIfDue,
  startHistoryRotation,
} from '../src/server/history-storage';
import { appendPromptHistory } from '../src/server/history';
import type { PromptHistoryEntry } from '../src/types';

function entry(timestamp: Date, prompt: string): PromptHistoryEntry {
  return {
    timestamp: timestamp.toISOString(),
    provider: 'deepseek',
    format: 'anthropic',
    prompt,
    response: 'response',
    status: 200,
    durationMs: 10,
  };
}

function serialize(entryValue: PromptHistoryEntry): string {
  return `${JSON.stringify(entryValue)}\n`;
}

async function readEntries(filePath: string, compressed = false): Promise<PromptHistoryEntry[]> {
  const raw = await readFile(filePath);
  const content = compressed ? zlib.gunzipSync(raw).toString('utf8') : raw.toString('utf8');
  return content.split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line) as PromptHistoryEntry);
}

test('rotates entries older than today into a gzip archive after the 3am cutoff', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'llm-proxy-rotation-'));
  try {
    const yesterday = new Date(2026, 10, 14, 12, 0, 0);
    const yesterdayEarlier = new Date(2026, 10, 14, 9, 0, 0);
    const todayEarly = new Date(2026, 10, 15, 1, 30, 0);
    await writeFile(historyFilePath(directory, 'deepseek'), [
      serialize(entry(yesterdayEarlier, 'yesterday earlier')),
      serialize(entry(yesterday, 'yesterday later')),
      serialize(entry(todayEarly, 'today early')),
    ].join(''));

    const archivedDates = rotateHistory(directory, 'deepseek', new Date(2026, 10, 15, 3, 5, 0));
    assert.deepEqual(archivedDates, ['2026-11-14']);

    const archive = await readEntries(archiveFilePath(directory, 'deepseek', '2026-11-14'), true);
    assert.deepEqual(archive.map((item) => item.prompt), ['yesterday earlier', 'yesterday later']);

    const current = await readEntries(historyFilePath(directory, 'deepseek'));
    assert.deepEqual(current.map((item) => item.prompt), ['today early']);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('does not rotate before the 3am cutoff', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'llm-proxy-rotation-'));
  try {
    const yesterday = new Date(2026, 10, 14, 12, 0, 0);
    await writeFile(historyFilePath(directory, 'deepseek'), serialize(entry(yesterday, 'yesterday')));

    const rotated = rotateHistoryIfDue(directory, 'deepseek', new Date(2026, 10, 15, 2, 59, 0));
    assert.equal(rotated, false);
    await assert.rejects(
      access(archiveFilePath(directory, 'deepseek', '2026-11-14')),
      { code: 'ENOENT' },
    );

    const current = await readEntries(historyFilePath(directory, 'deepseek'));
    assert.deepEqual(current.map((item) => item.prompt), ['yesterday']);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('archives each past day separately and stays idempotent', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'llm-proxy-rotation-'));
  try {
    await writeFile(historyFilePath(directory, 'deepseek'), [
      serialize(entry(new Date(2026, 10, 12, 12, 0, 0), 'two days ago')),
      serialize(entry(new Date(2026, 10, 14, 12, 0, 0), 'yesterday')),
      serialize(entry(new Date(2026, 10, 15, 1, 0, 0), 'today')),
    ].join(''));

    const now = new Date(2026, 10, 15, 3, 5, 0);
    assert.deepEqual(rotateHistory(directory, 'deepseek', now), ['2026-11-12', '2026-11-14']);
    assert.deepEqual(rotateHistory(directory, 'deepseek', now), []);

    const twoDaysAgo = await readEntries(archiveFilePath(directory, 'deepseek', '2026-11-12'), true);
    assert.deepEqual(twoDaysAgo.map((item) => item.prompt), ['two days ago']);
    const yesterday = await readEntries(archiveFilePath(directory, 'deepseek', '2026-11-14'), true);
    assert.deepEqual(yesterday.map((item) => item.prompt), ['yesterday']);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('appending after the 3am cutoff rotates the previous day first', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'llm-proxy-rotation-'));
  try {
    await writeFile(
      historyFilePath(directory, 'deepseek'),
      serialize(entry(new Date(2026, 10, 14, 12, 0, 0), 'yesterday')),
    );

    appendPromptHistory(
      directory,
      entry(new Date(2026, 10, 15, 3, 4, 0), 'today'),
      new Date(2026, 10, 15, 3, 5, 0),
    );

    const archive = await readEntries(archiveFilePath(directory, 'deepseek', '2026-11-14'), true);
    assert.deepEqual(archive.map((item) => item.prompt), ['yesterday']);

    const current = await readEntries(historyFilePath(directory, 'deepseek'));
    assert.deepEqual(current.map((item) => item.prompt), ['today']);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('periodic check rotates a running provider without new traffic', async (t) => {
  t.mock.timers.enable({
    apis: ['setInterval', 'Date'],
    now: new Date(2026, 10, 15, 2, 59, 0).getTime(),
  });
  const directory = await mkdtemp(path.join(os.tmpdir(), 'llm-proxy-rotation-'));
  try {
    await writeFile(
      historyFilePath(directory, 'deepseek'),
      serialize(entry(new Date(2026, 10, 14, 12, 0, 0), 'yesterday')),
    );

    const stop = startHistoryRotation(directory, 'deepseek');
    try {
      await assert.rejects(
        access(archiveFilePath(directory, 'deepseek', '2026-11-14')),
        { code: 'ENOENT' },
      );

      t.mock.timers.tick(2 * 60_000);

      const archive = await readEntries(archiveFilePath(directory, 'deepseek', '2026-11-14'), true);
      assert.deepEqual(archive.map((item) => item.prompt), ['yesterday']);
    } finally {
      stop();
    }
  } finally {
    t.mock.timers.reset();
    await rm(directory, { recursive: true, force: true });
  }
});

test('lists archived dates together with today', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'llm-proxy-rotation-'));
  try {
    await writeFile(archiveFilePath(directory, 'deepseek', '2026-11-12'), zlib.gzipSync(''));
    await writeFile(archiveFilePath(directory, 'deepseek', '2026-11-14'), zlib.gzipSync(''));
    await writeFile(archiveFilePath(directory, 'ollama', '2026-11-13'), zlib.gzipSync(''));

    const now = new Date(2026, 10, 15, 10, 0, 0);
    assert.deepEqual(listPromptHistoryDates(directory, 'deepseek', now), [
      '2026-11-12',
      '2026-11-14',
      '2026-11-15',
    ]);
    assert.deepEqual(listPromptHistoryDates(directory, undefined, now), [
      '2026-11-12',
      '2026-11-13',
      '2026-11-14',
      '2026-11-15',
    ]);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
