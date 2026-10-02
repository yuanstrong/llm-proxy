import assert from 'node:assert/strict';
import * as http from 'node:http';
import { once } from 'node:events';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import test from 'node:test';
import type { AddressInfo } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { createLogger } from '../src/server/logger';
import { createProxyServer } from '../src/server/server';
import type { ProviderConfig } from '../src/types';

test('routes /anthropic/v1/messages to the configured anthropic endpoint only', async () => {
  let upstreamPath = '';
  let upstreamBody = '';
  let upstreamApiKey = '';
  let upstreamAuthorization = '';
  const logs: string[] = [];
  const upstream = http.createServer((req, res) => {
    upstreamPath = req.url ?? '';
    upstreamApiKey = req.headers['x-api-key'] ?? '';
    upstreamAuthorization = req.headers.authorization ?? '';
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => {
      upstreamBody = Buffer.concat(chunks).toString('utf8');
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end('{"ok":true}');
    });
  });
  upstream.listen(0, '127.0.0.1');
  await once(upstream, 'listening');
  const upstreamAddress = upstream.address() as AddressInfo;

  const provider: ProviderConfig = {
    name: 'deepseek',
    listen: { host: '127.0.0.1', port: 0 },
    endpoints: { anthropic: `http://127.0.0.1:${upstreamAddress.port}/anthropic` },
    models: {},
    api_key: 'deepseek-test-key',
  };
  const proxy = createProxyServer(
    provider,
    createLogger('debug', (level, message) => logs.push(`${level} ${message}`)),
  );
  proxy.listen(0, '127.0.0.1');
  await once(proxy, 'listening');
  const proxyAddress = proxy.address() as AddressInfo;

  try {
    const response = await fetch(`http://127.0.0.1:${proxyAddress.port}/anthropic/v1/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{"model":"claude-sonnet-4-6"}',
    });
    assert.equal(response.status, 200);
    assert.equal(upstreamPath, '/anthropic/v1/messages');
    assert.equal(upstreamApiKey, 'deepseek-test-key');
    assert.equal(upstreamAuthorization, '');
    assert.equal(upstreamBody, '{"model":"claude-sonnet-4-6"}');
    assert.ok(logs.some((line) => line.includes('debug request provider=deepseek method=POST url=/anthropic/v1/messages')));
    assert.ok(logs.some((line) => line.includes('debug response provider=deepseek method=POST url=/anthropic/v1/messages status=200')));

    const legacyResponse = await fetch(`http://127.0.0.1:${proxyAddress.port}/v1/messages`, {
      method: 'POST',
    });
    assert.equal(legacyResponse.status, 400);
    assert.ok(logs.some((line) => line.includes('debug request provider=deepseek method=POST url=/v1/messages')));
    assert.ok(logs.some((line) => line.includes('debug response provider=deepseek method=POST url=/v1/messages status=400')));
  } finally {
    await Promise.all([
      new Promise<void>((resolve, reject) => proxy.close((error) => (error ? reject(error) : resolve()))),
      new Promise<void>((resolve, reject) => upstream.close((error) => (error ? reject(error) : resolve()))),
    ]);
  }
});

test('does not append the Anthropic path twice when the endpoint is already complete', async () => {
  let upstreamPath = '';
  const upstream = http.createServer((req, res) => {
    upstreamPath = req.url ?? '';
    res.end('{"ok":true}');
  });
  upstream.listen(0, '127.0.0.1');
  await once(upstream, 'listening');
  const upstreamAddress = upstream.address() as AddressInfo;

  const provider: ProviderConfig = {
    name: 'anthropic',
    listen: { host: '127.0.0.1', port: 0 },
    endpoints: { anthropic: `http://127.0.0.1:${upstreamAddress.port}/v1/messages` },
    models: {},
  };
  const proxy = createProxyServer(provider);
  proxy.listen(0, '127.0.0.1');
  await once(proxy, 'listening');
  const proxyAddress = proxy.address() as AddressInfo;

  try {
    const response = await fetch(`http://127.0.0.1:${proxyAddress.port}/anthropic/v1/messages`, {
      method: 'POST',
      body: '{}',
    });
    assert.equal(response.status, 200);
    assert.equal(upstreamPath, '/v1/messages');
  } finally {
    await Promise.all([
      new Promise<void>((resolve, reject) => proxy.close((error) => (error ? reject(error) : resolve()))),
      new Promise<void>((resolve, reject) => upstream.close((error) => (error ? reject(error) : resolve()))),
    ]);
  }
});

test('routes OpenAI paths under the /openai base path', async () => {
  const upstreamPaths: string[] = [];
  const upstream = http.createServer((req, res) => {
    upstreamPaths.push(req.url ?? '');
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end('{"ok":true}');
  });
  upstream.listen(0, '127.0.0.1');
  await once(upstream, 'listening');
  const upstreamAddress = upstream.address() as AddressInfo;

  const provider: ProviderConfig = {
    name: 'deepseek',
    listen: { host: '127.0.0.1', port: 0 },
    endpoints: {
      'openai-completions': `http://127.0.0.1:${upstreamAddress.port}/v1/chat/completions`,
      'openai-responses': `http://127.0.0.1:${upstreamAddress.port}/v1/responses`,
    },
    models: {},
  };
  const proxy = createProxyServer(provider);
  proxy.listen(0, '127.0.0.1');
  await once(proxy, 'listening');
  const proxyAddress = proxy.address() as AddressInfo;

  try {
    const completionsResponse = await fetch(
      `http://127.0.0.1:${proxyAddress.port}/openai/v1/chat/completions`,
      { method: 'POST', body: '{}' },
    );
    assert.equal(completionsResponse.status, 200);

    const responsesResponse = await fetch(
      `http://127.0.0.1:${proxyAddress.port}/openai/v1/responses`,
      { method: 'POST', body: '{}' },
    );
    assert.equal(responsesResponse.status, 200);

    const legacyResponse = await fetch(
      `http://127.0.0.1:${proxyAddress.port}/v1/chat/completions`,
      { method: 'POST', body: '{}' },
    );
    assert.equal(legacyResponse.status, 400);
    assert.deepEqual(upstreamPaths, ['/v1/chat/completions', '/v1/responses']);
  } finally {
    await Promise.all([
      new Promise<void>((resolve, reject) => proxy.close((error) => (error ? reject(error) : resolve()))),
      new Promise<void>((resolve, reject) => upstream.close((error) => (error ? reject(error) : resolve()))),
    ]);
  }
});

test('rejects paths that only start with the Anthropic messages path', async () => {
  const provider: ProviderConfig = {
    name: 'deepseek',
    listen: { host: '127.0.0.1', port: 0 },
    endpoints: { anthropic: 'http://127.0.0.1:1/anthropic' },
    models: {},
  };
  const proxy = createProxyServer(provider);
  proxy.listen(0, '127.0.0.1');
  await once(proxy, 'listening');
  const proxyAddress = proxy.address() as AddressInfo;

  try {
    const response = await fetch(`http://127.0.0.1:${proxyAddress.port}/anthropic/v1/messages-extra`, {
      method: 'POST',
    });
    assert.equal(response.status, 400);
  } finally {
    await new Promise<void>((resolve, reject) => proxy.close((error) => (error ? reject(error) : resolve())));
  }
});

test('serves the Anthropic health check and configured model list locally', async () => {
  const provider: ProviderConfig = {
    name: 'deepseek',
    listen: { host: '127.0.0.1', port: 0 },
    endpoints: { anthropic: 'http://127.0.0.1:1/anthropic' },
    models: {
      'claude-opus-4-7': 'deepseek-v4-pro',
      'claude-sonnet-4-6': 'deepseek-flash',
    },
  };
  const proxy = createProxyServer(provider);
  proxy.listen(0, '127.0.0.1');
  await once(proxy, 'listening');
  const proxyAddress = proxy.address() as AddressInfo;

  try {
    const health = await fetch(`http://127.0.0.1:${proxyAddress.port}/anthropic`, { method: 'HEAD' });
    assert.equal(health.status, 200);

    const modelsResponse = await fetch(
      `http://127.0.0.1:${proxyAddress.port}/anthropic/v1/models?limit=1000`,
    );
    assert.equal(modelsResponse.status, 200);
    assert.deepEqual(await modelsResponse.json(), {
      data: [
        {
          type: 'model',
          id: 'claude-opus-4-7',
          display_name: 'claude-opus-4-7',
          created_at: '1970-01-01T00:00:00Z',
          max_input_tokens: null,
          max_tokens: null,
          capabilities: null,
        },
        {
          type: 'model',
          id: 'claude-sonnet-4-6',
          display_name: 'claude-sonnet-4-6',
          created_at: '1970-01-01T00:00:00Z',
          max_input_tokens: null,
          max_tokens: null,
          capabilities: null,
        },
      ],
      first_id: 'claude-opus-4-7',
      has_more: false,
      last_id: 'claude-sonnet-4-6',
    });
  } finally {
    await new Promise<void>((resolve, reject) => proxy.close((error) => (error ? reject(error) : resolve())));
  }
});

test('captures OpenAI prompt and response in prompt history without changing the response', async () => {
  const runtimeHome = await mkdtemp(path.join(os.tmpdir(), 'llm-proxy-history-'));
  const upstream = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => {
      assert.match(Buffer.concat(chunks).toString('utf8'), /Hello provider/);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ choices: [{ message: { content: 'Hello user' } }] }));
    });
  });
  upstream.listen(0, '127.0.0.1');
  await once(upstream, 'listening');
  const upstreamAddress = upstream.address() as AddressInfo;
  const provider: ProviderConfig = {
    name: 'history-provider',
    listen: { host: '127.0.0.1', port: 0 },
    endpoints: { 'openai-completions': `http://127.0.0.1:${upstreamAddress.port}/v1/chat/completions` },
    models: {},
  };
  const proxy = createProxyServer(provider, undefined, path.join(runtimeHome, 'history'));
  proxy.listen(0, '127.0.0.1');
  await once(proxy, 'listening');
  const proxyAddress = proxy.address() as AddressInfo;

  try {
    const response = await fetch(`http://127.0.0.1:${proxyAddress.port}/openai/v1/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'gpt-test', messages: [{ role: 'user', content: 'Hello provider' }] }),
    });
    assert.deepEqual(await response.json(), { choices: [{ message: { content: 'Hello user' } }] });
    const history = JSON.parse(
      (await readFile(path.join(runtimeHome, 'history', 'history-provider.jsonl'), 'utf8')).trim(),
    ) as Record<string, unknown>;
    assert.equal(history.provider, 'history-provider');
    assert.equal(history.format, 'openai-completions');
    assert.equal(history.model, 'gpt-test');
    assert.equal(history.prompt, 'Hello provider');
    assert.equal(history.response, 'Hello user');
    assert.equal(history.status, 200);
  } finally {
    await Promise.all([
      new Promise<void>((resolve, reject) => proxy.close((error) => (error ? reject(error) : resolve()))),
      new Promise<void>((resolve, reject) => upstream.close((error) => (error ? reject(error) : resolve()))),
    ]);
    await rm(runtimeHome, { recursive: true, force: true });
  }
});
