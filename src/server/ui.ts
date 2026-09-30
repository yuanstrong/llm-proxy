import * as fs from 'fs';
import * as path from 'path';
import type { IncomingMessage, ServerResponse } from 'http';

const CONTENT_TYPES: Record<string, string> = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
};

export function serveUi(
  req: IncomingMessage,
  res: ServerResponse,
  uiRoot: string,
): boolean {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    return false;
  }

  const pathname = new URL(req.url ?? '/', 'http://localhost').pathname;
  const relativePath = pathname === '/' ? 'index.html' : pathname.slice(1);

  let decodedPath: string;
  try {
    decodedPath = decodeURIComponent(relativePath);
  } catch {
    res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Invalid URL');
    return true;
  }

  const root = path.resolve(uiRoot);
  const filePath = path.resolve(root, decodedPath);
  if (filePath !== root && !filePath.startsWith(`${root}${path.sep}`)) {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Not Found');
    return true;
  }

  if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Not Found');
    return true;
  }

  const contentType = CONTENT_TYPES[path.extname(filePath)] ?? 'application/octet-stream';
  const content = fs.readFileSync(filePath);
  res.writeHead(200, {
    'Content-Type': contentType,
    'Content-Length': String(content.length),
  });
  if (req.method !== 'HEAD') {
    res.end(content);
  } else {
    res.end();
  }
  return true;
}
