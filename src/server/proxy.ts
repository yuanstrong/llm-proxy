import { IncomingMessage, ServerResponse } from 'http';
import * as http from 'http';
import * as https from 'https';
import * as zlib from 'node:zlib';
import type { ApiFormat } from '../types';
import { appendPromptHistory, createHistoryEntry, extractRequestDetails } from './history';
import type { Logger } from './logger';

const MAX_HISTORY_RESPONSE_BYTES = 512_000;

interface HistoryResponseCapture {
  finish: () => Promise<string>;
}

function resolveTargetUrl(targetUrl: string, format: ApiFormat): URL {
  const url = new URL(targetUrl);

  if (format === 'anthropic' && !url.pathname.endsWith('/v1/messages')) {
    url.pathname = `${url.pathname.replace(/\/+$/, '')}/v1/messages`;
  }

  return url;
}

function normalizeContentEncoding(value: string | string[] | undefined): string {
  return (Array.isArray(value) ? value.join(',') : value ?? '').trim().toLowerCase();
}

// Returns undefined for identity bodies, null for encodings we cannot decode.
function createContentDecoder(encoding: string): NodeJS.ReadWriteStream | undefined | null {
  switch (encoding) {
    case '':
    case 'identity':
      return undefined;
    case 'gzip':
    case 'x-gzip':
      return zlib.createGunzip();
    case 'deflate':
      return zlib.createUnzip();
    case 'br':
      return zlib.createBrotliDecompress();
    case 'zstd':
      return zlib.createZstdDecompress();
    default:
      return null;
  }
}

function createHistoryResponseCapture(
  proxyRes: IncomingMessage,
  logger?: Logger,
): HistoryResponseCapture | undefined {
  const encoding = normalizeContentEncoding(proxyRes.headers['content-encoding']);
  const decoder = createContentDecoder(encoding);
  if (decoder === null) {
    logger?.warn(`Unsupported content-encoding '${encoding}'; skipping prompt history capture`);
    return undefined;
  }

  const chunks: Buffer[] = [];
  let captured = 0;
  const collect = (chunk: Buffer | string): void => {
    if (captured >= MAX_HISTORY_RESPONSE_BYTES) return;
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    const remaining = MAX_HISTORY_RESPONSE_BYTES - captured;
    chunks.push(buffer.subarray(0, remaining));
    captured += Math.min(buffer.length, remaining);
  };

  if (!decoder) {
    proxyRes.on('data', collect);
    return { finish: async () => Buffer.concat(chunks).toString('utf8') };
  }

  const decoded = new Promise<void>((resolve) => {
    decoder.once('end', resolve);
    decoder.once('close', resolve);
    // A truncated or malformed stream must not crash the proxy; keep whatever
    // text was decoded so far instead of failing the request.
    decoder.on('error', () => resolve());
  });
  decoder.on('data', collect);
  proxyRes.pipe(decoder);

  return {
    finish: async () => {
      await decoded;
      return Buffer.concat(chunks).toString('utf8');
    },
  };
}

export function proxyRequest(
  req: IncomingMessage,
  res: ServerResponse,
  targetUrl: string,
  models: Record<string, string>,
  apiKey?: string,
  format: ApiFormat = 'openai-completions',
  logger?: Logger,
  history?: { provider: string; directory: string },
): void {
  const bodyChunks: Buffer[] = [];

  req.on('data', (chunk: Buffer) => {
    bodyChunks.push(chunk);
  });

  req.on('end', () => {
    const bodyBuffer = Buffer.concat(bodyChunks);
    let finalBody = bodyBuffer;
    const requestDetails = history
      ? extractRequestDetails(bodyBuffer.toString('utf8'))
      : undefined;
    const startedAt = process.hrtime.bigint();

    const headers: Record<string, string | string[] | undefined> = {
      ...req.headers,
    };

    if (bodyBuffer.length > 0) {
      try {
        const json = JSON.parse(bodyBuffer.toString('utf-8'));
        if (json.model && models[json.model]) {
          json.model = models[json.model];
          const newBody = JSON.stringify(json);
          finalBody = Buffer.from(newBody, 'utf-8');
          headers['content-length'] = String(finalBody.length);
        }
      } catch {
        // Non-JSON body: passthrough unmodified
      }
    }

    const url = resolveTargetUrl(targetUrl, format);
    const isHttps = url.protocol === 'https:';
    headers.host = url.host;

    if (apiKey) {
      if (format === 'anthropic') {
        headers['x-api-key'] = apiKey;
        delete headers.authorization;
      } else {
        headers.authorization = `Bearer ${apiKey}`;
      }
    }

    const options: http.RequestOptions = {
      hostname: url.hostname,
      port: url.port || (isHttps ? 443 : 80),
      path: url.pathname + url.search,
      method: req.method,
      headers,
    };

    const transport = isHttps ? https : http;

    const proxyReq = transport.request(options, (proxyRes) => {
      const capture = history && requestDetails
        ? createHistoryResponseCapture(proxyRes, logger)
        : undefined;

      proxyRes.once('end', () => {
        if (!capture || !history || !requestDetails) return;
        void capture.finish().then((responseBody) => {
          try {
            appendPromptHistory(history.directory, createHistoryEntry(
              history.provider,
              format,
              requestDetails,
              responseBody,
              proxyRes.statusCode ?? 502,
              Number(process.hrtime.bigint() - startedAt) / 1_000_000,
            ));
          } catch (error) {
            logger?.warn(`Unable to write prompt history: ${error instanceof Error ? error.message : 'unknown error'}`);
          }
        });
      });
      res.writeHead(proxyRes.statusCode ?? 502, proxyRes.headers);
      proxyRes.pipe(res, { end: true });
    });

    proxyReq.on('error', (err: NodeJS.ErrnoException) => {
      logger?.error(`Upstream request failed: ${err.message}`);
      if (!res.headersSent) {
        res.writeHead(502, { 'Content-Type': 'text/plain' });
        res.end(`Bad Gateway: ${err.message}`);
      }
    });

    if (finalBody.length > 0) {
      proxyReq.write(finalBody);
    }
    proxyReq.end();
  });
}
