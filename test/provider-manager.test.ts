import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtemp, readFile, stat, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { ProviderManager } from '../src/server/provider-manager';
import { getLogDirectory } from '../src/server/runtime';
import type { AppConfig } from '../src/types';

const config: AppConfig = {
  management: { host: '127.0.0.1', port: 3000 },
  configPath: '/tmp/llm-proxy-test-config.toml',
  providers: {
    deepseek: {
      name: 'deepseek',
      listen: { host: '127.0.0.1', port: 9876 },
      endpoints: { 'openai-completions': 'http://127.0.0.1:9/v1/chat/completions' },
      models: {},
    },
  },
};

function idleChild(): ChildProcess {
  return spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' });
}

function noisyChild(): ChildProcess {
  return spawn(
    process.execPath,
    ['-e', "console.log('stdout-line'); console.error('stderr-line'); setInterval(() => {}, 1000)"],
    { stdio: ['ignore', 'pipe', 'pipe'] },
  );
}

function burstChild(): ChildProcess {
  return spawn(
    process.execPath,
    [
      '-e',
      "const stdout = Array.from({length: 5000}, (_, i) => 'stdout-' + i + '\\n').join(''); const stderr = Array.from({length: 5000}, (_, i) => 'stderr-' + i + '\\n').join(''); process.stdout.write(stdout); process.stderr.write(stderr); setTimeout(() => {}, 1000)",
    ],
    { stdio: ['ignore', 'pipe', 'pipe'] },
  );
}

async function waitForLog(logPath: string, required = ['stdout-line', 'stderr-line']): Promise<string> {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    try {
      const content = await readFile(logPath, 'utf8');
      if (required.every((marker) => content.includes(marker))) return content;
    } catch {
      // The child may not have emitted its first log lines yet.
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(`Timed out waiting for ${logPath}`);
}

test('provider manager writes and removes provider PID files', async () => {
  const runtimeHome = await mkdtemp(path.join(os.tmpdir(), 'llm-proxy-home-'));
  const manager = new ProviderManager(config, { LLM_PROXY_HOME: runtimeHome }, () => idleChild());

  try {
    const started = await manager.start('deepseek');
    const pidPath = path.join(runtimeHome, 'var', 'pids', 'deepseek.pid');
    assert.equal(started.running, true);
    assert.equal(Number(await readFile(pidPath, 'utf8')), started.pid);
    assert.deepEqual((await manager.status()).map(({ name, running }) => ({ name, running })), [
      { name: 'deepseek', running: true },
    ]);

    const stopped = await manager.stop('deepseek');
    assert.equal(stopped.running, false);
    await assert.rejects(stat(pidPath), { code: 'ENOENT' });
  } finally {
    await manager.shutdown();
    await rm(runtimeHome, { recursive: true, force: true });
  }
});

test('provider manager rejects unknown providers', async () => {
  const runtimeHome = await mkdtemp(path.join(os.tmpdir(), 'llm-proxy-home-'));
  const manager = new ProviderManager(config, { LLM_PROXY_HOME: runtimeHome }, () => idleChild());

  try {
    await assert.rejects(manager.start('missing-provider'), /Unknown provider/);
  } finally {
    await manager.shutdown();
    await rm(runtimeHome, { recursive: true, force: true });
  }
});

test('provider manager captures child stdout and stderr in the provider log', async () => {
  const runtimeHome = await mkdtemp(path.join(os.tmpdir(), 'llm-proxy-home-'));
  const manager = new ProviderManager(config, { LLM_PROXY_HOME: runtimeHome }, () => noisyChild());
  const logPath = path.join(getLogDirectory({ LLM_PROXY_HOME: runtimeHome }), 'deepseek.log');

  try {
    await manager.start('deepseek');
    const content = await waitForLog(logPath);
    assert.match(content, /\[deepseek\] stdout-line/);
    assert.match(content, /\[deepseek\] stderr-line/);
  } finally {
    await manager.shutdown();
    await rm(runtimeHome, { recursive: true, force: true });
  }
});

test('provider manager flushes all child output before stop resolves', async () => {
  const runtimeHome = await mkdtemp(path.join(os.tmpdir(), 'llm-proxy-home-'));
  const manager = new ProviderManager(config, { LLM_PROXY_HOME: runtimeHome }, () => burstChild());
  const logPath = path.join(getLogDirectory({ LLM_PROXY_HOME: runtimeHome }), 'deepseek.log');
  const stdoutChunks: string[] = [];
  const stderrChunks: string[] = [];
  const originalStdoutWrite = process.stdout.write;
  const originalStderrWrite = process.stderr.write;
  process.stdout.write = ((chunk: string | Uint8Array) => {
    stdoutChunks.push(Buffer.from(chunk).toString('utf8'));
    return true;
  }) as typeof process.stdout.write;
  process.stderr.write = ((chunk: string | Uint8Array) => {
    stderrChunks.push(Buffer.from(chunk).toString('utf8'));
    return true;
  }) as typeof process.stderr.write;

  try {
    await manager.start('deepseek');
    await waitForLog(logPath, ['stdout-0', 'stderr-0']);
    await manager.stop('deepseek');

    const content = await readFile(logPath, 'utf8');
    assert.match(content, /\[deepseek\] stdout-4999\n/);
    assert.match(content, /\[deepseek\] stderr-4999\n/);
    assert.match(stdoutChunks.join(''), /\[deepseek\] stdout-4999\n/);
    assert.match(stderrChunks.join(''), /\[deepseek\] stderr-4999\n/);
  } finally {
    process.stdout.write = originalStdoutWrite;
    process.stderr.write = originalStderrWrite;
    await manager.shutdown();
    await rm(runtimeHome, { recursive: true, force: true });
  }
});
