import * as fs from 'node:fs';
import * as http from 'node:http';
import * as path from 'node:path';
import type { AppConfig, LogLevel, ManagementStatus, ProviderManagerApi, ProviderOverview } from '../types';
import { getHistoryDirectory, getLogDirectory } from './runtime';
import { readLogEntries, readPromptHistory } from './observability';
import { listPromptHistoryDates, localDateString } from './history-storage';
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
  runtimeEnv: NodeJS.ProcessEnv = process.env,
): http.Server {
  return http.createServer(async (req, res) => {
    const pathname = (req.url ?? '/').split('?')[0];

    if (req.method === 'GET' && pathname === '/admin/api/status') {
      const statuses = await manager.status();
      const statusByName = new Map(statuses.map((provider) => [provider.name, provider]));
      const providers: ProviderOverview[] = Object.values(config.providers).map((provider) => {
        const current = statusByName.get(provider.name) ?? {
          name: provider.name,
          listen: provider.listen,
          running: false,
        };
        const host = provider.listen.host.includes(':') ? `[${provider.listen.host}]` : provider.listen.host;
        const base = `http://${host}:${provider.listen.port}`;
        return {
          ...current,
          endpoints: provider.endpoints,
          logLevel: provider.log_level ?? 'info',
          baseUrls: {
            openai: `${base}/openai`,
            anthropic: `${base}/anthropic`,
          },
        };
      });
      const status: ManagementStatus = {
        providerCount: Object.keys(config.providers).length,
        providers,
      };
      sendJson(res, 200, status);
      return;
    }

    if (req.method === 'GET' && pathname === '/admin/api/logs') {
      const requestUrl = new URL(req.url ?? '/', 'http://127.0.0.1');
      const provider = requestUrl.searchParams.get('provider') || undefined;
      const rawLevel = requestUrl.searchParams.get('level') || undefined;
      const level = rawLevel as LogLevel | undefined;
      if (level && !['debug', 'info', 'warn', 'error'].includes(level)) {
        sendJson(res, 400, { error: 'level must be one of debug, info, warn, error' });
        return;
      }
      sendJson(res, 200, readLogEntries(getLogDirectory(runtimeEnv), {
        provider,
        level,
        limit: readLimit(requestUrl),
      }));
      return;
    }

    if (req.method === 'GET' && pathname === '/admin/api/prompt-history/dates') {
      const requestUrl = new URL(req.url ?? '/', 'http://127.0.0.1');
      const now = new Date();
      const dates = listPromptHistoryDates(
        getHistoryDirectory(runtimeEnv),
        requestUrl.searchParams.get('provider') || undefined,
        now,
      );
      sendJson(res, 200, { dates, today: localDateString(now) });
      return;
    }

    if (req.method === 'GET' && pathname === '/admin/api/prompt-history') {
      const requestUrl = new URL(req.url ?? '/', 'http://127.0.0.1');
      const date = requestUrl.searchParams.get('date') || undefined;
      if (date && !isHistoryDate(date)) {
        sendJson(res, 400, { error: 'date must use YYYY-MM-DD format' });
        return;
      }
      sendJson(res, 200, readPromptHistory(getHistoryDirectory(runtimeEnv), {
        provider: requestUrl.searchParams.get('provider') || undefined,
        date,
        limit: readLimit(requestUrl),
      }));
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

function isHistoryDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number);
  const parsed = new Date(year, month - 1, day);
  return parsed.getFullYear() === year && parsed.getMonth() === month - 1 && parsed.getDate() === day;
}

function readLimit(requestUrl: URL): number {
  const rawLimit = requestUrl.searchParams.get('limit');
  if (rawLimit === null) return 200;
  const limit = Number(rawLimit);
  return Number.isInteger(limit) && limit > 0 ? Math.min(limit, 500) : 200;
}
