import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import test from 'node:test';
import type { AddressInfo } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { loadConfig } from '../src/server/config';
import { loadDotEnv } from '../src/server/env';
import { createManagementServer } from '../src/server/management-server';
import type { AppConfig, ProviderManagerApi, ProviderStatus } from '../src/types';

const providers = {
  deepseek: {
    name: 'deepseek',
    listen: { host: '127.0.0.1', port: 9876 },
    log_level: 'debug',
    endpoints: {
      anthropic: 'https://api.deepseek.com/anthropic',
      'openai-completions': 'http://127.0.0.1:9/v1/chat/completions',
    },
    models: { 'claude-sonnet-4-6': 'test-model' },
    api_key: 'must-not-be-returned',
  },
  ollama: {
    name: 'ollama',
    listen: { host: '127.0.0.1', port: 9877 },
    endpoints: { 'openai-completions': 'http://127.0.0.1:11434/v1/chat/completions' },
    models: {},
  },
};

const config: AppConfig = {
  management: { host: '127.0.0.1', port: 0 },
  configPath: '/tmp/llm-proxy-test-config.toml',
  providers,
};

const running: ProviderStatus[] = [
  { name: 'deepseek', listen: providers.deepseek.listen, running: true, pid: 1234 },
  { name: 'ollama', listen: providers.ollama.listen, running: false },
];

function fakeManager(): ProviderManagerApi & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    async status() {
      return running;
    },
    async start(name) {
      calls.push(`start:${name}`);
      return { name, listen: config.providers[name].listen, running: true, pid: 9999 };
    },
    async stop(name) {
      calls.push(`stop:${name}`);
      return { name, listen: config.providers[name].listen, running: false };
    },
  };
}

test('admin overview returns provider metadata and never exposes API keys', async () => {
  const manager = fakeManager();
  const server = createManagementServer(config, manager);
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');

  const address = server.address() as AddressInfo;
  const response = await fetch(`http://127.0.0.1:${address.port}/admin/api/status`);
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(body.providerCount, 2);
  assert.deepEqual(body.providers, [
    {
      ...running[0],
      endpoints: providers.deepseek.endpoints,
      logLevel: 'debug',
      baseUrls: {
        openai: 'http://127.0.0.1:9876/openai',
        anthropic: 'http://127.0.0.1:9876/anthropic',
      },
    },
    {
      ...running[1],
      endpoints: providers.ollama.endpoints,
      logLevel: 'info',
      baseUrls: {
        openai: 'http://127.0.0.1:9877/openai',
        anthropic: 'http://127.0.0.1:9877/anthropic',
      },
    },
  ]);
  assert.equal(JSON.stringify(body).includes('must-not-be-returned'), false);

  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
});

test('admin logs can be filtered by provider and level', async () => {
  const runtimeHome = await mkdtemp(path.join(os.tmpdir(), 'llm-proxy-observability-'));
  await mkdir(path.join(runtimeHome, 'var', 'logs'), { recursive: true });
  await writeFile(
    path.join(runtimeHome, 'var', 'logs', 'deepseek.log'),
    '[deepseek] [debug] request provider=deepseek method=POST url=/openai/v1/chat/completions\n' +
      '[deepseek] [error] upstream failed\n',
  );
  await writeFile(
    path.join(runtimeHome, 'var', 'logs', 'ollama.log'),
    '[ollama] [info] listening\n',
  );
  const server = createManagementServer(config, fakeManager(), undefined, { LLM_PROXY_HOME: runtimeHome });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address() as AddressInfo;

  try {
    const response = await fetch(
      `http://127.0.0.1:${address.port}/admin/api/logs?provider=deepseek&level=error`,
    );
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), [
      { provider: 'deepseek', level: 'error', message: 'upstream failed' },
    ]);
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
    await rm(runtimeHome, { recursive: true, force: true });
  }
});

test('admin prompt history is returned newest first and can be filtered by provider', async () => {
  const runtimeHome = await mkdtemp(path.join(os.tmpdir(), 'llm-proxy-history-'));
  await mkdir(path.join(runtimeHome, 'var', 'history'), { recursive: true });
  const older = {
    timestamp: '2026-10-02T08:00:00.000Z',
    provider: 'deepseek',
    format: 'anthropic',
    model: 'claude-sonnet-4-6',
    prompt: 'Earlier prompt',
    response: 'Earlier response',
    status: 200,
    durationMs: 120,
  };
  const newer = { ...older, timestamp: '2026-10-02T09:00:00.000Z', prompt: 'Latest prompt' };
  await writeFile(
    path.join(runtimeHome, 'var', 'history', 'deepseek.jsonl'),
    `${JSON.stringify(older)}\n${JSON.stringify(newer)}\n`,
  );
  const server = createManagementServer(config, fakeManager(), undefined, { LLM_PROXY_HOME: runtimeHome });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address() as AddressInfo;

  try {
    const response = await fetch(
      `http://127.0.0.1:${address.port}/admin/api/prompt-history?provider=deepseek`,
    );
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), [newer, older]);
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
    await rm(runtimeHome, { recursive: true, force: true });
  }
});

test('management page and provider controls are served by the manager port', async () => {
  const uiRoot = await mkdtemp(path.join(os.tmpdir(), 'llm-proxy-ui-'));
  await writeFile(path.join(uiRoot, 'index.html'), '<!doctype html><title>LLM Proxy</title>');
  const manager = fakeManager();
  const server = createManagementServer(config, manager, uiRoot);
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address() as AddressInfo;

  const page = await fetch(`http://127.0.0.1:${address.port}/`);
  assert.equal(page.status, 200);
  assert.match(await page.text(), /LLM Proxy/);

  const start = await fetch(`http://127.0.0.1:${address.port}/admin/api/providers/ollama/start`, {
    method: 'POST',
  });
  const stop = await fetch(`http://127.0.0.1:${address.port}/admin/api/providers/deepseek/stop`, {
    method: 'POST',
  });
  assert.equal(start.status, 200);
  assert.equal(stop.status, 200);
  assert.deepEqual(manager.calls, ['start:ollama', 'stop:deepseek']);

  const unknown = await fetch(`http://127.0.0.1:${address.port}/admin/api/providers/missing/start`, {
    method: 'POST',
  });
  assert.equal(unknown.status, 404);

  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
  await rm(uiRoot, { recursive: true, force: true });
});

test('config loads all providers and their listen addresses from TOML', async () => {
  const configRoot = await mkdtemp(path.join(os.tmpdir(), 'llm-proxy-config-'));
  const configPath = path.join(configRoot, 'config.toml');
  await writeFile(
    configPath,
    [
      '[providers.deepseek]',
      'listen = "127.0.0.1:9000"',
      'log_level = "debug"',
      '',
      '[providers.deepseek.endpoints]',
      'openai-completions = "http://127.0.0.1:11434/v1/chat/completions"',
      '',
      '[providers.ollama]',
      'listen = "127.0.0.1:9001"',
      '',
      '[providers.ollama.endpoints]',
      'openai-completions = "http://127.0.0.1:11434/v1/chat/completions"',
    ].join('\n'),
  );

  try {
    const loaded = loadConfig(configPath);
    assert.deepEqual(Object.keys(loaded.providers), ['deepseek', 'ollama']);
    assert.deepEqual(loaded.providers.deepseek.listen, { host: '127.0.0.1', port: 9000 });
    assert.equal(loaded.providers.deepseek.log_level, 'debug');
    assert.equal(loaded.providers.ollama.log_level, 'info');
    assert.deepEqual(loaded.management, { host: '127.0.0.1', port: 3000 });
  } finally {
    await rm(configRoot, { recursive: true, force: true });
  }
});

test('loads dotenv values without overriding existing environment variables', async () => {
  const envRoot = await mkdtemp(path.join(os.tmpdir(), 'llm-proxy-env-'));
  const envPath = path.join(envRoot, '.env');
  const environment: NodeJS.ProcessEnv = { EXISTING_VALUE: 'from-shell' };
  await writeFile(
    envPath,
    ['DEEPSEEK_API_KEY="from-dotenv"', 'EXISTING_VALUE="from-dotenv"'].join('\n'),
  );

  try {
    loadDotEnv(envPath, environment);
    assert.equal(environment.DEEPSEEK_API_KEY, 'from-dotenv');
    assert.equal(environment.EXISTING_VALUE, 'from-shell');
  } finally {
    await rm(envRoot, { recursive: true, force: true });
  }
});

test('expands environment references in TOML provider values', async () => {
  const configRoot = await mkdtemp(path.join(os.tmpdir(), 'llm-proxy-config-env-'));
  const configPath = path.join(configRoot, 'config.toml');
  const previousKey = process.env.DEEPSEEK_API_KEY;
  process.env.DEEPSEEK_API_KEY = 'from-environment';
  await writeFile(
    configPath,
    [
      '[providers.deepseek]',
      'listen = "127.0.0.1:9000"',
      'api_key = "${DEEPSEEK_API_KEY}"',
      '',
      '[providers.deepseek.endpoints]',
      'openai-completions = "http://127.0.0.1:11434/v1/chat/completions"',
    ].join('\n'),
  );

  try {
    const loaded = loadConfig(configPath);
    assert.equal(loaded.providers.deepseek.api_key, 'from-environment');
  } finally {
    if (previousKey === undefined) delete process.env.DEEPSEEK_API_KEY;
    else process.env.DEEPSEEK_API_KEY = previousKey;
    await rm(configRoot, { recursive: true, force: true });
  }
});
