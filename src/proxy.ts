import { IncomingMessage, ServerResponse } from 'http';
import * as http from 'http';
import * as https from 'https';

export function proxyRequest(
  req: IncomingMessage,
  res: ServerResponse,
  targetUrl: string,
  models: Record<string, string>,
  apiKey?: string,
): void {
  const bodyChunks: Buffer[] = [];

  req.on('data', (chunk: Buffer) => {
    bodyChunks.push(chunk);
  });

  req.on('end', () => {
    const bodyBuffer = Buffer.concat(bodyChunks);
    let finalBody = bodyBuffer;

    const headers: Record<string, string | string[] | undefined> = {
      ...req.headers,
    };

    // Parse and replace model name
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

    // Prepare target URL and headers
    const url = new URL(targetUrl);
    const isHttps = url.protocol === 'https:';
    headers.host = url.host;

    if (apiKey) {
      headers['authorization'] = `Bearer ${apiKey}`;
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
      res.writeHead(proxyRes.statusCode ?? 502, proxyRes.headers);
      proxyRes.pipe(res, { end: true });
    });

    proxyReq.on('error', (err: NodeJS.ErrnoException) => {
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
