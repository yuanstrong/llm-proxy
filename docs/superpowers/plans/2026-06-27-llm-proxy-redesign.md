# LLM Proxy Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rewrite the single-file hardcoded proxy into a TypeScript project that reads TOML config, auto-detects API format, and routes to configurable LLM provider endpoints with model name remapping.

**Architecture:** 5 source files with clear boundaries — types, config loading, proxy forwarding, HTTP server, and entry point. Config selects one provider via `LLM_PROXY_PROVIDER` env var; the provider declares supported API formats as full endpoint URLs. HTTP server detects format from request path, matches against provider endpoints, replaces model name in request body, and pipes the response through unchanged (SSE-compatible).

**Tech Stack:** TypeScript, tsx, pnpm, native `http`/`https`, `smol-toml`

---

## File Responsibility Map

| File | Responsibility | Depends on |
|------|---------------|------------|
| `src/types.ts` | Shared type definitions and format-detection lookup | nothing |
| `src/config.ts` | TOML parsing, validation, provider selection | `types.ts` |
| `src/proxy.ts` | Model name replacement + pipe forwarding | `types.ts` |
| `src/server.ts` | HTTP server, format detection, routing | `types.ts`, `proxy.ts` |
| `src/index.ts` | Entry point: wire config → server → listen | `config.ts`, `server.ts` |
| `config.toml` | Default configuration file | nothing |
| `tsconfig.json` | TypeScript compiler config | nothing |
| `package.json` | Updated with deps and scripts | nothing |

---

### Task 1: Project Setup

**Files:**
- Modify: `package.json`
- Create: `tsconfig.json`

- [ ] **Step 1: Update package.json with dependencies and scripts**

```json
{
  "name": "llm-proxy",
  "version": "1.0.0",
  "description": "Multi-provider LLM proxy with TOML config",
  "main": "src/index.ts",
  "scripts": {
    "start": "tsx src/index.ts",
    "dev": "tsx --watch src/index.ts"
  },
  "repository": {
    "type": "git",
    "url": "git+https://github.com/hikari-van-horn/llm-proxy.git"
  },
  "author": "Hikari",
  "license": "MIT",
  "bugs": {
    "url": "https://github.com/hikari-van-horn/llm-proxy/issues"
  },
  "homepage": "https://github.com/hikari-van-horn/llm-proxy#readme",
  "dependencies": {
    "smol-toml": "^1.7.0"
  },
  "devDependencies": {
    "@types/node": "^22.0.0",
    "tsx": "^4.0.0",
    "typescript": "^5.0.0"
  }
}
```

- [ ] **Step 2: Create tsconfig.json**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "commonjs",
    "lib": ["ES2022"],
    "outDir": "./dist",
    "rootDir": "./src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist"]
}
```

- [ ] **Step 3: Install dependencies**

```bash
pnpm install
```

Expected: installs `smol-toml`, `tsx`, `typescript`, `@types/node`

- [ ] **Step 4: Commit**

```bash
git add package.json pnpm-lock.yaml tsconfig.json
git commit -m "chore: set up TypeScript project with tsx, pnpm, and smol-toml"
```

---

### Task 2: Type Definitions

**Files:**
- Create: `src/types.ts`

- [ ] **Step 1: Create types.ts with all shared types**

```typescript
export type ApiFormat = 'anthropic' | 'openai-completions' | 'openai-responses';

export interface ProviderConfig {
  name: string;
  api_key?: string;
  endpoints: Partial<Record<ApiFormat, string>>;
  models: Record<string, string>;
}

export interface AppConfig {
  listen: { host: string; port: number };
  provider: ProviderConfig;
}
```

- [ ] **Step 2: Compile check**

```bash
pnpm exec tsc --noEmit src/types.ts
```

Expected: no errors

- [ ] **Step 3: Commit**

```bash
git add src/types.ts
git commit -m "feat: add shared type definitions"
```

---

### Task 3: Config Loading & Validation

**Files:**
- Create: `src/config.ts`

- [ ] **Step 1: Create config.ts**

```typescript
import * as fs from 'fs';
import * as path from 'path';
import { parse } from 'smol-toml';
import { AppConfig, ProviderConfig } from './types';

export function loadConfig(configPath?: string): AppConfig {
  const filePath = configPath ?? path.resolve(__dirname, '..', 'config.toml');

  if (!fs.existsSync(filePath)) {
    console.error(`Config file not found: ${filePath}`);
    process.exit(1);
  }

  let raw: any;
  try {
    raw = parse(fs.readFileSync(filePath, 'utf-8'));
  } catch (e: any) {
    console.error(`Failed to parse config.toml: ${e.message}`);
    process.exit(1);
  }

  // Validate listen
  const listenStr = raw.listen;
  if (typeof listenStr !== 'string' || !listenStr.includes(':')) {
    console.error('config.toml: "listen" must be in "host:port" format (e.g. "127.0.0.1:8964")');
    process.exit(1);
  }
  const lastColon = listenStr.lastIndexOf(':');
  const host = listenStr.substring(0, lastColon);
  const port = parseInt(listenStr.substring(lastColon + 1), 10);
  if (isNaN(port) || port < 1 || port > 65535) {
    console.error(`config.toml: invalid port in "listen": ${listenStr}`);
    process.exit(1);
  }

  // Validate provider selection
  const providerName = process.env.LLM_PROXY_PROVIDER;
  if (!providerName) {
    console.error('LLM_PROXY_PROVIDER environment variable is required');
    console.error('Usage: LLM_PROXY_PROVIDER=<name> pnpm start');
    process.exit(1);
  }

  const providers = raw.providers as Record<string, any> | undefined;
  if (!providers || Object.keys(providers).length === 0) {
    console.error('config.toml: no [providers] section defined');
    process.exit(1);
  }

  const providerRaw = providers[providerName];
  if (!providerRaw) {
    const available = Object.keys(providers).join(', ');
    console.error(`Provider "${providerName}" not found in config.toml. Available: ${available}`);
    process.exit(1);
  }

  // Validate endpoints
  const endpoints = (providerRaw.endpoints ?? {}) as Record<string, string>;
  if (typeof endpoints !== 'object' || Object.keys(endpoints).length === 0) {
    console.error(`Provider "${providerName}" has no endpoints defined`);
    process.exit(1);
  }

  // Validate each endpoint URL
  for (const [format, url] of Object.entries(endpoints)) {
    if (typeof url !== 'string') {
      console.error(`Provider "${providerName}": endpoint "${format}" must be a URL string`);
      process.exit(1);
    }
    try {
      new URL(url);
    } catch {
      console.error(`Provider "${providerName}": endpoint "${format}" has invalid URL: ${url}`);
      process.exit(1);
    }
  }

  const models = (providerRaw.models ?? {}) as Record<string, string>;

  const provider: ProviderConfig = {
    name: providerName,
    api_key: providerRaw.api_key,
    endpoints,
    models,
  };

  return { listen: { host, port }, provider };
}
```

- [ ] **Step 2: Compile check**

```bash
pnpm exec tsc --noEmit src/config.ts src/types.ts
```

Expected: no errors

- [ ] **Step 3: Commit**

```bash
git add src/config.ts
git commit -m "feat: add config loading with TOML parsing and validation"
```

---

### Task 4: Proxy Logic (Model Replacement + Forwarding)

**Files:**
- Create: `src/proxy.ts`

- [ ] **Step 1: Create proxy.ts**

```typescript
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
          headers['content-length'] = finalBody.length;
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
```

- [ ] **Step 2: Compile check**

```bash
pnpm exec tsc --noEmit src/proxy.ts src/types.ts
```

Expected: no errors

- [ ] **Step 3: Commit**

```bash
git add src/proxy.ts
git commit -m "feat: add proxy logic with model name replacement and pipe forwarding"
```

---

### Task 5: HTTP Server (Format Detection + Routing)

**Files:**
- Create: `src/server.ts`

- [ ] **Step 1: Create server.ts**

```typescript
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
```

- [ ] **Step 2: Compile check**

```bash
pnpm exec tsc --noEmit src/server.ts src/proxy.ts src/config.ts src/types.ts
```

Expected: no errors

- [ ] **Step 3: Commit**

```bash
git add src/server.ts
git commit -m "feat: add HTTP server with auto format detection and routing"
```

---

### Task 6: Entry Point

**Files:**
- Create: `src/index.ts`

- [ ] **Step 1: Create index.ts**

```typescript
import { loadConfig } from './config';
import { createServer } from './server';

const config = loadConfig();
const server = createServer(config);

server.listen(config.listen.port, config.listen.host, () => {
  const formats = Object.keys(config.provider.endpoints).join(', ');
  const modelCount = Object.keys(config.provider.models).length;
  console.log(`LLM Proxy started`);
  console.log(`  Listen: http://${config.listen.host}:${config.listen.port}`);
  console.log(`  Provider: ${config.provider.name}`);
  console.log(`  Formats: ${formats}`);
  console.log(`  Mapped models: ${modelCount}`);
});
```

- [ ] **Step 2: Compile check (full project)**

```bash
pnpm exec tsc --noEmit
```

Expected: no errors

- [ ] **Step 3: Commit**

```bash
git add src/index.ts
git commit -m "feat: add entry point wiring config, server, and listen"
```

---

### Task 7: Default Config File

**Files:**
- Create: `config.toml`

- [ ] **Step 1: Create config.toml with three example providers**

```toml
listen = "127.0.0.1:8964"

[providers.deepseek]
api_key = "sk-xxx"

[providers.deepseek.endpoints]
anthropic = "https://api.deepseek.com/anthropic"
openai-completions = "https://api.deepseek.com/v1/chat/completions"
openai-responses = "https://api.deepseek.com/v1/responses"

[providers.deepseek.models]
"claude-opus-4-7" = "deepseek-v4-pro"
"claude-sonnet-4-6" = "deepseek-v4-flash"
"claude-haiku-4-5" = "deepseek-v4-haiku"

[providers.anthropic]
api_key = "sk-ant-xxx"

[providers.anthropic.endpoints]
anthropic = "https://api.anthropic.com/v1/messages"

[providers.anthropic.models]
"claude-opus-4-7" = "claude-opus-4-7-20250219"
"claude-sonnet-4-6" = "claude-sonnet-4-6-20250508"

[providers.ollama-local]

[providers.ollama-local.endpoints]
openai-completions = "http://localhost:11434/v1/chat/completions"

[providers.ollama-local.models]
"claude-sonnet-4-6" = "llama3:latest"
"claude-haiku-4-5" = "qwen2.5:7b"
```

- [ ] **Step 2: Commit**

```bash
git add config.toml
git commit -m "feat: add default config.toml with three example providers"
```

---

### Task 8: Smoke Test & Cleanup

- [ ] **Step 1: Start the proxy with DeepSeek provider**

```bash
LLM_PROXY_PROVIDER=deepseek pnpm start
```

Expected output:
```
LLM Proxy started
  Listen: http://127.0.0.1:8964
  Provider: deepseek
  Formats: anthropic, openai-completions, openai-responses
  Mapped models: 3
```

- [ ] **Step 2: Test unsupported path returns 400**

In another terminal:
```bash
curl -s http://localhost:8964/v1/embeddings
```

Expected: `Unsupported API format. Supported paths: /v1/messages, /v1/chat/completions, /v1/responses`

- [ ] **Step 3: Test unsupported format returns 400**

```bash
LLM_PROXY_PROVIDER=ollama-local pnpm start
```

In another terminal:
```bash
curl -s -X POST http://localhost:8964/v1/messages -H 'Content-Type: application/json' -d '{"model":"test"}'
```

Expected: `Provider 'ollama-local' does not support anthropic format. Supported: openai-completions`

- [ ] **Step 4: Verify model replacement scenarios don't crash proxy**

Test that the proxy accepts valid JSON with mapped and unmapped models (doesn't crash, response depends on upstream connectivity):

```bash
# Mapped model — proxy should attempt forwarding (may get connection error since upstream is fake)
curl -s -X POST http://localhost:8964/v1/chat/completions \
  -H 'Content-Type: application/json' \
  -d '{"model":"claude-opus-4-7","messages":[{"role":"user","content":"hello"}]}'
# Expected: 502 Bad Gateway (no real DeepSeek backend) but NOT a 400 or crash

# Unmapped model — pass-through
curl -s -X POST http://localhost:8964/v1/chat/completions \
  -H 'Content-Type: application/json' \
  -d '{"model":"gpt-5","messages":[]}'
# Expected: 502 (model not in mapping, passes through, upstream unreachable)
```

- [ ] **Step 5: Remove old proxy.js**

```bash
rm src/proxy.js
```

- [ ] **Step 6: Verify clean compile**

```bash
pnpm exec tsc --noEmit
```

Expected: no errors

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "test: smoke test proxy and remove old proxy.js"
```
