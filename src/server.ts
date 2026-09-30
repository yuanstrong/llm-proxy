import * as http from 'http';
import { AppConfig, ApiFormat } from './types';
import { proxyRequest } from './proxy';

const PATH_FORMAT_MAP: Array<{ prefix: string; format: ApiFormat }> = [
  { prefix: '/v1/messages', format: 'anthropic' },
  { prefix: '/v1/chat/completions', format: 'openai-completions' },
  { prefix: '/v1/responses', format: 'openai-responses' },
];

export function createServer(config: AppConfig): http.Server {
  return http.createServer((req, res) => {
    const rawUrl = req.url ?? '/';
    const pathname = rawUrl.split('?')[0];

    // 1. Detect API format from URL path
    const match = PATH_FORMAT_MAP.find(({ prefix }) => pathname.startsWith(prefix));
    if (!match) {
      res.writeHead(400, { 'Content-Type': 'text/plain' });
      res.end(
        'Unsupported API format. Supported paths: /v1/messages, /v1/chat/completions, /v1/responses',
      );
      return;
    }

    const format: ApiFormat = match.format;

    // 2. Check provider supports this format
    const targetUrl = config.provider.endpoints[format];
    if (!targetUrl) {
      const supported = Object.keys(config.provider.endpoints).join(', ');
      res.writeHead(400, { 'Content-Type': 'text/plain' });
      res.end(
        `Provider '${config.provider.name}' does not support ${format} format. Supported: ${supported}`,
      );
      return;
    }

    // 3. Forward to proxy
    proxyRequest(req, res, targetUrl, config.provider.models, config.provider.api_key);
  });
}
