import * as fs from 'node:fs';
import * as http from 'node:http';
import * as path from 'node:path';
import type { AppConfig, ManagementStatus, ProviderManagerApi } from '../types';
import { serveUi } from './ui';

function defaultUiRoot(): string {
  const builtUiRoot = path.resolve(process.cwd(), 'dist', 'ui');
  if (fs.existsSync(path.join(builtUiRoot, 'index.html'))) return builtUiRoot;

  const compiledUiRoot = path.resolve(__dirname, '..', '..', 'ui');
  if (fs.existsSync(path.join(compiledUiRoot, 'index.html'))) return compiledUiRoot;

  const sourceUiRoot = path.resolve(__dirname, '..', 'ui');
  return sourceUiRoot;
}

function sendJson(res: http.ServerResponse, statusCode: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(statusCode, {
    'Cache-Control': 'no-store',
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': String(Buffer.byteLength(payload)),
  });
  res.end(payload);
}

export function createManagementServer(
  config: AppConfig,
  manager: ProviderManagerApi,
  uiRoot = defaultUiRoot(),
): http.Server {
  return http.createServer(async (req, res) => {
    const pathname = (req.url ?? '/').split('?')[0];

    if (req.method === 'GET' && pathname === '/admin/api/status') {
      const status: ManagementStatus = {
        providerCount: Object.keys(config.providers).length,
        providers: await manager.status(),
      };
      sendJson(res, 200, status);
      return;
    }

    const actionMatch = pathname.match(/^\/admin\/api\/providers\/([^/]+)\/(start|stop)$/);
    if (actionMatch) {
      if (req.method !== 'POST') {
        res.writeHead(405, { Allow: 'POST', 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('Method Not Allowed');
        return;
      }

      let providerName: string;
      try {
        providerName = decodeURIComponent(actionMatch[1]);
      } catch {
        res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('Invalid provider name');
        return;
      }

      if (!config.providers[providerName]) {
        sendJson(res, 404, { error: `Unknown provider '${providerName}'` });
        return;
      }

      try {
        const providerStatus = actionMatch[2] === 'start'
          ? await manager.start(providerName)
          : await manager.stop(providerName);
        sendJson(res, 200, providerStatus);
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Provider action failed';
        const statusCode = message.startsWith('Unknown provider') ? 404 : 500;
        sendJson(res, statusCode, { error: message });
      }
      return;
    }

    if (serveUi(req, res, uiRoot)) return;

    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Not Found');
  });
}
