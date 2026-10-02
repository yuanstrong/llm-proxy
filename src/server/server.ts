import * as http from 'node:http';
import type { ApiFormat, ProviderConfig } from '../types';
import { createLogger, type Logger } from './logger';
import { proxyRequest } from './proxy';
import { getHistoryDirectory } from './runtime';

const PATH_FORMAT_MAP: Array<{ prefix: string; format: ApiFormat }> = [
  { prefix: '/anthropic/v1/messages', format: 'anthropic' },
  { prefix: '/openai/v1/chat/completions', format: 'openai-completions' },
  { prefix: '/openai/v1/responses', format: 'openai-responses' },
];

const UNKNOWN_MODEL_CREATED_AT = '1970-01-01T00:00:00Z';

function sendJson(res: http.ServerResponse, statusCode: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': String(Buffer.byteLength(payload)),
  });
  res.end(payload);
}

function handleAnthropicControlRequest(
  provider: ProviderConfig,
  req: http.IncomingMessage,
  res: http.ServerResponse,
): boolean {
  const pathname = (req.url ?? '/').split('?')[0];

  if (req.method === 'HEAD' && pathname === '/anthropic') {
    res.writeHead(200, { 'Content-Length': '0' });
    res.end();
    return true;
  }

  if (req.method !== 'GET' || pathname !== '/anthropic/v1/models') return false;

  const requestUrl = new URL(req.url ?? '/', 'http://127.0.0.1');
  const rawLimit = requestUrl.searchParams.get('limit');
  const limit = rawLimit === null ? 20 : Number(rawLimit);
  if (!Number.isInteger(limit) || limit < 1 || limit > 1000) {
    sendJson(res, 400, { error: 'limit must be an integer between 1 and 1000' });
    return true;
  }

  const modelIds = Object.keys(provider.models);
  const models = modelIds.slice(0, limit).map((id) => ({
    type: 'model',
    id,
    display_name: id,
    created_at: UNKNOWN_MODEL_CREATED_AT,
    max_input_tokens: null,
    max_tokens: null,
    capabilities: null,
  }));

  sendJson(res, 200, {
    data: models,
    first_id: models[0]?.id ?? null,
    has_more: modelIds.length > models.length,
    last_id: models[models.length - 1]?.id ?? null,
  });
  return true;
}

function handleProxyRequest(
  provider: ProviderConfig,
  req: http.IncomingMessage,
  res: http.ServerResponse,
  logger: Logger,
  historyDirectory: string,
): void {
  const pathname = (req.url ?? '/').split('?')[0];
  const match = PATH_FORMAT_MAP.find(({ prefix }) => pathname === prefix);
  if (!match) {
    logger.warn(`Unsupported API path: ${req.url ?? '/'}`);
    res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end(
      'Unsupported API format. Supported paths: /anthropic/v1/messages, /openai/v1/chat/completions, /openai/v1/responses',
    );
    return;
  }

  const targetUrl = provider.endpoints[match.format];
  if (!targetUrl) {
    logger.warn(`Provider does not support ${match.format}`);
    const supported = Object.keys(provider.endpoints).join(', ');
    res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end(
      `Provider '${provider.name}' does not support ${match.format} format. Supported: ${supported}`,
    );
    return;
  }

  proxyRequest(
    req,
    res,
    targetUrl,
    provider.models,
    provider.api_key,
    match.format,
    logger,
    { provider: provider.name, directory: historyDirectory },
  );
}

export function createProxyServer(
  provider: ProviderConfig,
  logger = createLogger(provider.log_level ?? 'info'),
  historyDirectory = getHistoryDirectory(),
): http.Server {
  return http.createServer((req, res) => {
    const method = req.method ?? 'UNKNOWN';
    const requestUrl = req.url ?? '/';
    const startedAt = process.hrtime.bigint();
    let resultLogged = false;

    logger.debug(`request provider=${provider.name} method=${method} url=${requestUrl}`);

    const logResult = (outcome: 'finished' | 'closed'): void => {
      if (resultLogged) return;
      resultLogged = true;
      const durationMs = Number(process.hrtime.bigint() - startedAt) / 1_000_000;
      logger.debug(
        `response provider=${provider.name} method=${method} url=${requestUrl} ` +
        `status=${res.statusCode} outcome=${outcome} duration_ms=${durationMs.toFixed(2)}`,
      );
    };

    res.once('finish', () => logResult('finished'));
    res.once('close', () => logResult('closed'));
    if (handleAnthropicControlRequest(provider, req, res)) return;
    handleProxyRequest(provider, req, res, logger, historyDirectory);
  });
}

export const createServer = createProxyServer;
